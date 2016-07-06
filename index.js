var request = require('request-micro')
var urlJoin = require('url-join')

module.exports = cerberus

var cerberusVersion = 'v1'
var ec2MetadataUrl = 'http://169.254.169.254/latest/meta-data/iam/info'
var ec2InstanceDataUrl = 'http://169.254.169.254/latest/dynamic/instance-identity/document'

function log () { console.log.apply(console, ['cerberus-node'].concat(Array.prototype.slice.call(arguments))) }
function noop () { }

function shallowCopy (target, source) {
  for (var key in source) {
    if (source.hasOwnProperty(key)) {
      target[key] = source[key]
    }
  }
  return target
}

// Client Constructor
function cerberus (options) {
  if (!options || typeof options !== 'object') {
    throw new Error('options parameter is required')
  }
  // Copy so we can safely mutate
  options = shallowCopy({}, options)

  // Override options with env variables
  if (process.env.CERBERUS_TOKEN) {
    options.token = process.env.CERBERUS_TOKEN
  }
  if (process.env.CERBERUS_ADDR) {
    options.hostUrl = process.env.CERBERUS_ADDR
  }
  // Validate options
  if (!options.aws || typeof options.aws !== 'object') {
    throw new Error('options.aws parameter is required')
  }
  if (typeof options.hostUrl !== 'string') {
    throw new Error('options.hostUrl must be a URL string')
  }

  options.log = options.debug ? log : noop

  return {
    get: function (keyPath, cb) { return callCerberus('GET', options, keyPath, undefined, cb) },
    set: function (keyPath, data, cb) { return callCerberus('POST', options, keyPath, data, cb) },
    list: function (keyPath, cb) { return callCerberus('LIST', options, keyPath, undefined, cb) },
    delete: function (keyPath, cb) { return callCerberus('DELETE', options, keyPath, undefined, cb) }
  }
}

function callCerberus (type, options, keyPath, data, cb) {
  if (cb === undefined) {
    if (typeof global.Promise === 'function') {
      options.log('promise path')
      return new Promise(function (resolve, reject) {
        callCerberus(type, options, keyPath, data, function (err, result) {
          if (err) reject(err)
          else resolve(result)
        })
      })
    }
    // Otherwise
    throw new Error('No callback was supplied, and global.Promise is not a function. You must provide an async interface')
  }
  getToken(options, function (err, authToken) {
    var url = urlJoin(options.hostUrl, cerberusVersion, 'secret', keyPath)
    options.log('token retrieved', authToken, keyPath, url)
    if (err) return cb(err)
    request({
      method: type === 'LIST' ? 'GET' : type,
      url: url + (type === 'LIST' ? '?list=true' : ''),
      headers: { 'X-Vault-Token': authToken },
      body: data,
      json: true
    }, function (err, res, data) {
      options.log('key retrieved', data)
      if (err) return cb(err)
      else return cb(null, data.data)
    })
  })
}

function getToken (options, cb) {
  if (options.tokenExpiresAt && (options.tokenExpiresAt <= Date.now())) {
    options.tokenExpiresAt = null
    options.token = null
  }

  // Already has token
  if (options.token) return cb(null, options.token)

  // Default to Ec2 if lambdaContext is missing
  var handler = options.lambdaContext ? getLambdaMetadata : getEc2Metadata
  handler(options, function (err, metadata) {
    if (err) return cb(err)
    options.log('handler metadata', metadata)
    authenticate(options, metadata.accountId, metadata.roleName, metadata.region, cb)
  })
}

function authenticate (options, accountId, roleName, region, cb) {
  request.post({
    url: urlJoin(options.hostUrl, cerberusVersion, '/auth/iam-role'),
    body: { 'account_id': accountId, 'role_name': roleName, 'region': region },
    json: true
  }, function (err, res, authResult) {
    if (err) return cb(err)
    options.log('auth result', authResult)
    decryptAuthResult(options, region, authResult, function (err, token) {
      if (err) return cb(err)
      options.log('decrypt result', token)
      // Expire 10 seconds before lease is up, to account for latency
      options.tokenExpiresAt = Date.now + token['lease_duration'] - 600
      options.token = token['client_token']
      cb(null, options.token)
    })
  })
}

function decryptAuthResult (options, region, authResult, cb) {
  options.log('decrypting', authResult)
  if (!authResult['auth_data']) {
    return cb(new Error('cannot decrypt token, auth_data is missing'))
  }
  var text = new Buffer(authResult['auth_data'], 'base64')
  // options.log('config', options.aws.config)
  // options.log('aws', options.aws)
  var kms = new options.aws.KMS({ apiVersion: '2014-11-01', region: options.aws.config.region || region })

  kms.decrypt({ CiphertextBlob: text }, function (err, kmsResult) {
    options.log('kms result', kmsResult)
    if (err) {
      return cb(!isKmsAccessError(err)
        ? err
        : new Error('You do not have access to the KMS key required for authentication. The most likely cause is that your IAM role does not have the KMS Decrypt action. You will need to add it to your role.'))
    }
    var token

    try {
      token = JSON.parse(new Buffer(kmsResult.Plaintext).toString())
    } catch (e) {
      cb(new Error('Error parsing KMS decrypt Result. ' + e.message))
      return
    }
    cb(null, token)
  })
}

function isKmsAccessError (error) {
  return error.message && error.message.indexOf('The ciphertext references a key that either does not exist or you do not have access to') !== -1
}

function getEc2Metadata (options, cb) {
  var iam = new options.aws.IAM({apiVersion: '2010-05-08'})
  var metadata = { }

  request({ url: ec2MetadataUrl, json: true }, function (err, result, data) {
    if (err) return cb(err)
    if (data.Code !== 'Success') return cb(data)

    var arn = data.InstanceProfileArn.split(':')
    var instanceProfileName = arn[5].substring(arn[5].indexOf('/') + 1)
    metadata.accountId = arn[4]

    iam.getInstanceProfile({ InstanceProfileName: instanceProfileName }, function (err, data) {
      if (err) return cb(err)
      var roles = data.InstanceProfile.Roles
      if (!roles.length) return cb(new Error('No roles returned for instance profile ' + instanceProfileName))

      metadata.roleName = roles[0].RoleName

      request({ url: ec2InstanceDataUrl, json: true }, function (err, result, data) {
        if (err) return cb(err)
        metadata.region = data.region
        options.log('metadata', metadata)
        cb(null, metadata)
      })
    })
  })
}

function getLambdaMetadata (options, cb) {
  var lambda = new options.aws.Lambda({ apiVersion: '2015-03-31' })
  var arn = options.lambdaContext.invokedFunctionArn.split(':')

  var metadata = { region: arn[3], accountId: arn[4] }
  var params = { FunctionName: arn[6], Qualifier: arn[7] }

  lambda.getFunctionConfiguration(params, function (err, data) {
    if (err) {
      options.log('error getting metadata', err, err.stack)
      return cb(err)
    }

    metadata.roleName = data.Role.split('/')[1]
    options.log('retrieved metadata values', metadata)
    cb(null, metadata)
  })
}
