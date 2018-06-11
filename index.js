'use strict'

const co = require('co')
const request = require('request-micro')
const urlJoin = require('url-join')
const linereader = require('./lib/linereader')
const kms = require('./lib/kms')
const lambda = require('./lib/lambda')
const sts = require('./lib/sts')
const packageData = require('./package.json')

module.exports = cerberus

const globalHeaders = {
  'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`
}

const cerberusVersion = 'v1'
const ec2MetadataUrl = 'http://169.254.169.254/latest/meta-data/iam/info'
const ec2RoleUrl = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'
const ec2InstanceDataUrl = 'http://169.254.169.254/latest/dynamic/instance-identity/document'
const ecsMetadataUrl = 'http://169.254.170.2/v2/metadata'

function log () { console.log.apply(console, ['cerberus-node'].concat(Array.prototype.slice.call(arguments))) }
function noop () { }

// Client Constructor
function cerberus (options) {
  if (!options || typeof options !== 'object') {
    throw new Error('options parameter is required')
  }
  // Copy so we can safely mutate
  let context = Object.assign({}, options)
  context.log = context.debug ? log : noop

  // Override context with env variables
  let envToken = getEnvironmentVariable(process.env.CERBERUS_TOKEN)
  if (envToken) {
    context.log('environment variable token found', envToken)
    context.token = envToken
  }

  let envHost = getEnvironmentVariable(process.env.CERBERUS_ADDR)
  if (envHost) {
    context.log('environment variable host url found', envHost)
    context.hostUrl = envHost
  }
  // Validate context
  if (typeof context.hostUrl !== 'string') {
    throw new Error('options.hostUrl must be a URL string')
  }

  let get = (keyPath, cb) => callCerberus(context, 'GET', keyPath, undefined, cb)
  let set = (keyPath, data, cb) => callCerberus(context, 'POST', keyPath, data, cb)
  let remove = (keyPath, cb) => callCerberus(context, 'DELETE', keyPath, undefined, cb)
  let list = (keyPath, cb) => callCerberus(context, 'LIST', keyPath, undefined, cb)
  let setLambdaContext = (lambdaContext) => { context.lambdaContext = lambdaContext }

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

function callCerberus (context, type, keyPath, data, cb) {
  context.log(`Starting ${type} request for ${keyPath}`)
  let action = co(function * () {
    let token = yield getToken(context)
    if (!token) throw new Error('unable to retrieve token')

    let url = urlJoin(context.hostUrl, cerberusVersion, 'secret', keyPath)
    context.log('token retrieved', token, keyPath, url)

    let keyResponse = yield request({
      method: type === 'LIST' ? 'GET' : type,
      url: url + (type === 'LIST' ? '?list=true' : ''),
      headers: Object.assign({}, globalHeaders, { 'X-Vault-Token': token }),
      body: data,
      json: true
    })

    let keyResult = keyResponse.data
    if (keyResult && keyResult.errors && keyResult.errors.length > 0) throw new Error(formatCerberusError(keyResult.errors))

    context.log('key retrieved', keyResponse.statusCode.toString(), keyResult)
    if (keyResponse.statusCode && keyResponse.statusCode.toString()[0] !== '2') throw new Error('Key Request error, Status: ' + keyResponse.statusCode)

    return keyResult && keyResult.data
  })
  if (cb) {
    action
      .then(result => cb(null, result))
      .catch(err => cb(err))
  } else {
    return action
  }
}

const getToken = co.wrap(function * (context) {
  // tokenExpiresAt in secs, Date.now in ms
  if (context.tokenExpiresAt && (context.tokenExpiresAt <= (Date.now() / 1000))) {
    context.tokenExpiresAt = null
    context.token = null
  }

  // Already has token
  if (context.token) {
    context.log('returning stored token')
    return context.token
  }

  let token
  if (context.prompt) {
    token = yield getTokenFromPrompt(context)
  } else if (context.assumeRoleArn && context.region) {
    let assumeRoleResponse = yield sts.assumeRole({ assumeRoleArn: context.assumeRoleArn })
    let assumeRoleCredentials = assumeRoleResponse.AssumeRoleResponse.AssumeRoleResult.Credentials
    context.credentials = {
      accessKeyId: assumeRoleCredentials.AccessKeyId,
      secretAccessKey: assumeRoleCredentials.SecretAccessKey,
      sessionToken: assumeRoleCredentials.SessionToken
    }
    token = yield authenticateWithIamRole(context, context.assumeRoleArn, context.region)
  } else {
    let handler = getEc2Metadata
    if (context.lambdaContext) handler = getLambdaMetadata
    if (context.ecsTaskRoleName) handler = getEcsMetadata

    let metadata = yield handler(context)
    if (!metadata) throw new Error('No metadata returned from authentication handler')
    context.log('handler metadata retrieved', metadata)
    var iamPrincipalArn = 'arn:aws:iam::' + metadata.accountId + ':role/' + metadata.roleName
    token = yield authenticateWithIamRole(context, iamPrincipalArn, metadata.region)
  }

  // Set token on context
  if (token) {
    // Expire 60 seconds before lease is up, to account for latency
    context.tokenExpiresAt = (Date.now() / 1000) + token['lease_duration'] - 60  // token TTL in secs, Date.now in ms
    context.token = token['client_token']
    return context.token
  }
})

const getTokenFromPrompt = co.wrap(function * (context) {
  if (!context.prompt) throw new Error('Tried to get prompt illegally')
  context.log('getting credentials from prompt')
  let email = yield linereader.readLine({ prompt: 'Nike Email: ' })
  let password = yield linereader.readLine({ prompt: 'Password: ', replace: '*' })
  context.authorization = makeAuthHeader(email, password)
  let authResponse = yield request({
    method: 'GET',
    url: urlJoin(context.hostUrl, 'v2/auth/user'),
    headers: { 'authorization': context.authorization },
    protocol: 'https',
    json: true
  })
  if (authResponse.data && authResponse.data.errors) throw new Error(formatCerberusError(authResponse.data.errors))
  if (authResponse.data.status === 'mfa_req') {
    context.log('mfa required', authResponse.data)
    let mfaAnswer = yield linereader.readLine({ prompt: 'MultiFactor Auth for ' + authResponse.data['data']['devices'][0]['name'] + ': ' })
    let mfaResponse = yield request.post({
      url: urlJoin(context.hostUrl, 'v2/auth/mfa_check'),
      protocol: 'https',
      headers: globalHeaders,
      json: true,
      body: {
        state_token: authResponse.data['data'].state_token,
        device_id: authResponse.data['data']['devices'][0].id,
        otp_token: mfaAnswer
      }
    })
    if (mfaResponse.data && mfaResponse.data.errors) throw new Error(formatCerberusError(mfaResponse.data.errors))
    context.log('mfa response', mfaResponse.data)
    return mfaResponse.data['data']['client_token']
  } else {
    context.log('user token retrieved', authResponse.data)
    return authResponse.data['data']['client_token']
  }
})

const authenticateWithIamRole = co.wrap(function * (context, iamPrincipalArn, region) {
  let authResponse = yield request.post({
    url: urlJoin(context.hostUrl, 'v2/auth/iam-principal'),
    headers: globalHeaders,
    body: { iam_principal_arn: iamPrincipalArn, 'region': region },
    json: true
  })
  let authResult = authResponse.data
  if (!authResult) throw new Error('cerberus returned empty authentication result')
  context.log('auth result', authResult)
  context.log('decrypting', authResult)
  if (authResult.errors) throw new Error(`Cerberus Authentication error: ${formatCerberusError(authResult.errors)}`)
  if (!authResult['auth_data']) throw new Error('cannot decrypt token, auth_data is missing')
  let token = yield kms.decrypt(authResult['auth_data'], { region: region, context: context, credentials: context.credentials })
  context.log('decrypt result', token)
  return token
})

const getEcsMetadata = co.wrap(function * (context) {
  context.log('getting ecs metadata')
  let metadataResponse = yield request({ url: ecsMetadataUrl, json: true })
  let data = metadataResponse.data
  if (!data) throw new Error(data)
  context.log('ecs data', data)
  let arn = data.TaskARN.split(':')
  return {
    accountId: arn[4],
    roleName: context.ecsTaskRoleName,
    region: arn[3]
  }
})

const getEc2Metadata = co.wrap(function * (context) {
  context.log('getting ec2 metadata')
  let metadata = { }
  let metadataResponse = yield request({ url: ec2MetadataUrl, json: true })
  let data = metadataResponse.data
  if (!data || data.Code !== 'Success') throw new Error(data)
  context.log('ec2 metadata', data)
  let arn = data.InstanceProfileArn.split(':')
  metadata.accountId = arn[4]

  let roleResponse = yield request({ url: ec2RoleUrl })
  context.log('ec2 role', roleResponse.data.toString())
  metadata.roleName = roleResponse.data.toString()

  let credentialsResponse = yield request({ url: ec2RoleUrl + metadata.roleName, json: true })
  context.log('credentials received')

  context.credentials = {
    accessKeyId: credentialsResponse.data.AccessKeyId,
    secretAccessKey: credentialsResponse.data.SecretAccessKey,
    sessionToken: credentialsResponse.data.Token
  }

  let instanceResponse = yield request({ url: ec2InstanceDataUrl, json: true })
  context.log('ec2 instance metadata', instanceResponse.data)
  metadata.region = instanceResponse.data.region
  return metadata
})

const getLambdaMetadata = co.wrap(function * (context) {
  context.log('getting lambda metadata')
  let arn = context.lambdaContext.invokedFunctionArn.split(':')

  let metadata = { region: arn[3], accountId: arn[4] }
  let lambdaMetadata = yield lambda.getFunctionConfiguration({ FunctionName: arn[6], Qualifier: arn[7], region: metadata.region })
    .catch(error => {
      context.log('error getting lambda conf', error)
      throw error
    })

  metadata.roleName = lambdaMetadata.Role.split('/')[1]
  return metadata
})

function getEnvironmentVariable (value) {
  return value && value !== 'undefined' && value !== undefined && value !== null ? value : undefined
}

function makeAuthHeader (username, password) {
  return 'Basic ' + new Buffer(username + ':' + password).toString('base64')
}

const formatCerberusError = (errors) => {
  return errors instanceof Array
    ? errors.map(e => e.message || e).join(', ')
    : JSON.stringify(errors)
}
