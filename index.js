var request = require('request-micro')
var urlJoin = require('url-join')
var linereader = require('./lib/linereader')

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
  var context = shallowCopy({}, options)
  context.log = context.debug ? log : noop

  // Override context with env variables
  var envToken = getEnvironmentVariable(process.env.CERBERUS_TOKEN)
  if (envToken) {
    context.log('environment variable token found', envToken)
    context.token = envToken
  }

  var envHost = getEnvironmentVariable(process.env.CERBERUS_ADDR)
  if (envHost) {
    context.log('environment variable host url found', envHost)
    context.hostUrl = envHost
  }
  // Validate context
  if (!context.aws || typeof context.aws !== 'object') {
    throw new Error('options.aws parameter is required')
  }
  if (typeof context.hostUrl !== 'string') {
    throw new Error('options.hostUrl must be a URL string')
  }

  var get = function (keyPath, cb) { return callCerberus('GET', context, keyPath, undefined, cb) }
  var set = function (keyPath, data, cb) { return callCerberus('POST', context, keyPath, data, cb) }
  var remove = function (keyPath, cb) { return callCerberus('DELETE', context, keyPath, undefined, cb) }
  var list = function (keyPath, cb) { return callCerberus('LIST', context, keyPath, undefined, cb) }
  var setLambdaContext = function (lambdaContext) { context.lambdaContext = lambdaContext }

  return {
    get: get,
    set: set,
    put: set,
    list: list,
    delete: remove,
    remove: remove,
    setLambdaContext: setLambdaContext
  }
}

function callCerberus (type, context, keyPath, data, cb) {
  if (cb === undefined) {
    if (typeof global.Promise === 'function') {
      context.log('promise path')
      return new Promise(function (resolve, reject) {
        callCerberus(type, context, keyPath, data, function (err, result) {
          if (err) reject(err)
          else resolve(result)
        })
      })
    }
    // Otherwise
    throw new Error('No callback was supplied, and global.Promise is not a function. You must provide an async interface')
  }
  context.log('getting token')
  getToken(context, function (err, authToken) {
    if (err) return cb(err)
    if (!authToken) return cb('Token is null')
    var url = urlJoin(context.hostUrl, cerberusVersion, 'secret', keyPath)
    context.log('token retrieved', authToken, keyPath, url)
    request({
      method: type === 'LIST' ? 'GET' : type,
      url: url + (type === 'LIST' ? '?list=true' : ''),
      headers: { 'X-Vault-Token': authToken },
      body: data,
      json: true
    }, function (err, res, result) {
      if (err) return cb(err)
      if (result && result.errors && result.errors.length > 0) return cb(result.errors[0])
      context.log('key retrieved', res.statusCode.toString(), result)
      if (res.statusCode && res.statusCode.toString()[0] !== '2') return cb(new Error('Key Request error, Status: ' + res.statusCode))

      return cb(null, result && result.data)
    })
  })
}

function getToken (context, cb) {
  // tokenExpiresAt in secs, Date.now in ms
  if (context.tokenExpiresAt && (context.tokenExpiresAt <= (Date.now() / 1000))) {
    context.tokenExpiresAt = null
    context.token = null
  }

  // Already has token
  if (context.token) {
    context.log('returning stored token')
    return cb(null, context.token)
  }

  // Default to Ec2 if lambdaContext is missing
  var handler = context.lambdaContext ? getLambdaMetadata : getEc2Metadata
  handler(context, function (err, metadata) {
    if (err || !metadata) {
      context.log('auth handler returned', err || metadata)
      if (!context.prompt) return cb(err || 'No metadata returned from authentication handler')
      else return getPromptToken(context, cb)
    }
    context.log('handler metadata retrieved', metadata)
    authenticate(context, metadata.accountId, metadata.roleName, metadata.region, cb)
  })
}

function setToken (context, token, cb) {
  // Expire 10 seconds before lease is up, to account for latency
  context.tokenExpiresAt = (Date.now() / 1000) + token['lease_duration'] - 10  // token TTL in secs, Date.now in ms
  context.token = token['client_token']
  cb(null, context.token)
}

function getPromptToken (context, cb) {
  if (!context.prompt) throw new Error('Tried to get prompt illegally')
  context.log('getting credentials from prompt')
  linereader.readLine({ prompt: 'Nike Email: ' }, function (err, email) {
    if (err) return cb(err)
    linereader.readLine({ prompt: 'Password: ', replace: '*' }, function (pErr, password) {
      if (pErr) return cb(pErr)
      context.authorization = makeAuthHeader(email, password)
      request({
        method: 'GET',
        url: urlJoin(context.hostUrl, 'v2/auth/user'),
        headers: { 'authorization': context.authorization },
        protocol: 'https',
        json: true
      }, function (err, authResponse) {
        if (err) return cb(err)
        if (authResponse.data && authResponse.data.errors) return cb(authResponse.data.errors)
        if (authResponse.data.status === 'mfa_req') {
          context.log('mfa required', authResponse.data)
          linereader.readLine({ prompt: 'MultiFactor Auth for ' + authResponse.data['data']['devices'][0]['name'] + ': ' }, function (err, mfaResponse) {
            if (err) return cb(err)
            request.post({
              url: urlJoin(context.hostUrl, 'v2/auth/mfa_check'),
              protocol: 'https',
              json: true,
              body: {
                state_token: authResponse.data['data'].state_token,
                device_id: authResponse.data['data']['devices'][0].id,
                otp_token: mfaResponse
              }
            }, function (err, mfaResponse) {
              if (err) return cb(err)
              if (mfaResponse.data && mfaResponse.data.errors) return cb(mfaResponse.data.errors)
              context.log('mfa response', mfaResponse.data)
              setToken(context, mfaResponse.data['data']['client_token'], cb)
            })
          })
        } else {
          context.log('user token retrieved', authResponse.data)
          setToken(context, authResponse.data['data']['client_token'], cb)
        }
      })
    })
  })
}

function authenticate (context, accountId, roleName, region, cb) {
  request.post({
    url: urlJoin(context.hostUrl, cerberusVersion, '/auth/iam-role'),
    body: { 'account_id': accountId, 'role_name': roleName, 'region': region },
    json: true
  }, function (err, res, authResult) {
    if (err) return cb(err)
    if (!authResult) return cb(new Error('cerberus returned empty authentication result'))
    context.log('auth result', authResult)
    decryptAuthResult(context, region, authResult, function (err, token) {
      if (err) return cb(err)
      setToken(context, token, cb)
    })
  })
}

function decryptAuthResult (context, region, authResult, cb) {
  context.log('decrypting', authResult)
  if (authResult.errors) {
    var message = authResult.errors instanceof Array
      ? authResult.errors.map(e => e.message).join(', ')
      : JSON.stringify(authResult.errors)
    return cb(new Error(`Cerberus Authentication error: ${message}`))
  }
  if (!authResult['auth_data']) {
    return cb(new Error('cannot decrypt token, auth_data is missing'))
  }
  var text = new Buffer(authResult['auth_data'], 'base64')
  // context.log('config', context.aws.config)
  // context.log('aws', context.aws)
  var kms = new context.aws.KMS({ apiVersion: '2014-11-01', region: context.aws.config.region || region })

  kms.decrypt({ CiphertextBlob: text }, function (err, kmsResult) {
    context.log('kms result', kmsResult)
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
    context.log('decrypt result', token)
    cb(null, token)
  })
}

function isKmsAccessError (error) {
  return error.message && error.message.indexOf('The ciphertext references a key that either does not exist or you do not have access to') !== -1
}

function getEc2Metadata (context, cb) {
  var metadata = { }

  request({ url: ec2MetadataUrl, json: true }, function (err, result, data) {
    if (err) return cb(err)
    if (!data || data.Code !== 'Success') return cb(data)
    context.log(data)

    var arn = data.InstanceProfileArn.split(':')
    metadata.roleName = arn[5].substring(arn[5].indexOf('/') + 1)
    metadata.accountId = arn[4]

    request({ url: ec2InstanceDataUrl, json: true }, function (err, result, data) {
      if (err) return cb(err)
      metadata.region = data.region
      context.log('metadata', metadata)
      cb(null, metadata)
    })
  })
}

function getLambdaMetadata (context, cb) {
  var lambda = new context.aws.Lambda({ apiVersion: '2015-03-31' })
  var arn = context.lambdaContext.invokedFunctionArn.split(':')

  var metadata = { region: arn[3], accountId: arn[4] }
  var params = { FunctionName: arn[6], Qualifier: arn[7] }

  lambda.getFunctionConfiguration(params, function (err, data) {
    if (err) {
      context.log('error getting metadata', err, err.stack)
      return cb(err)
    }

    metadata.roleName = data.Role.split('/')[1]
    context.log('retrieved metadata values', metadata)
    cb(null, metadata)
  })
}

function getEnvironmentVariable (value) {
  return value && value !== 'undefined' && value !== undefined && value !== null ? value : undefined
}

function makeAuthHeader (username, password) {
  return 'Basic ' + new Buffer(username + ':' + password).toString('base64')
}
