'use strict'

const request = require('request-micro')
const urlJoin = require('url-join')
const FormData = require('form-data')
const packageData = require('./package.json')
const { getAuthenticationHeaders } = require('./lib/sts')

const globalHeaders = {
  'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`
}

const cerberusVersion = 'v1'

function log () { console.log.apply(console, ['cerberus-node'].concat(Array.prototype.slice.call(arguments))) }
function noop () { }

/**
 * Cerberus client with CRUD operations for secure data and files.
 *
 * @example
 * var CerberusClient = require('cerberus-node-client')
 *
 * var client = new CerberusClient({
 *   // string, The cerberus URL to use.
 *   hostUrl: YOUR_CERBERUS_HOST,
 *
 *   // boolean, defaults to false. When true will console.log many operations
 *   debug: true,
 *
 *   // This will be used as the cerberus X-Vault-Token if supplied
 *   // OVERRIDDEN by process.env.CERBERUS_TOKEN
 *   // If present, normal authentication with cerberus will be skipped
 *   // You should normally only be using this in testing environments
 *   // When developing locally, it is easier to use process.env.CERBERUS_TOKEN
 *   token: 'Some_Auth_Token'
 * })
 *
 * cerberusClient.getSecureData('path/to/my/secret').then(secureConfig => {
 *   //do something with config
 * })
 */
class CerberusClient {

  /**
   * @param {CerberusClientOptions} options The options for the Cerberus client.
   */
  constructor (options) {
    if (!options || typeof options !== 'object') {
      throw new Error('options parameter is required')
    }
    // Copy so we can safely mutate
    let configuration = Object.assign({}, options)
    configuration.log = configuration.debug ? log : noop

    // Override context with env variables
    let envToken = getEnvironmentVariable(process.env.CERBERUS_TOKEN)
    if (envToken) {
      configuration.log('environment variable token found', envToken)
      configuration.token = envToken
    }

    // Validate configuration
    if (typeof configuration.hostUrl !== 'string') {
      throw new Error('options.hostUrl must be a URL string')
    }

    this._configuration = configuration
  }

  /**
   * Fetches secure data.
   *
   * @param path The path for the secure data
   * @param {function} [cb] callback, will be called with resolved data if present
   * @return {Promise<object>} A promise that when resolved supplies the secure data
   */
  getSecureData (path, cb) {
    return doSecretAction(this._configuration, 'GET', path, undefined, cb)
  }

  /**
   * Writes secure data.
   *
   * @param path The path for the secure data
   * @param {function} [cb] callback, will be called when write is finished
   * @return {Promise<object>} A promise that will be resolved when the write is finished
   */
  writeSecureData (path, data, cb) {
    return doSecretAction(this._configuration, 'POST', path, data, cb)
  }

  /**
   * Deletes secure data.
   *
   * @param path The path for the secure data
   * @param {function} [cb] callback, will be called when delete is finished
   * @return {Promise<object>} A promise that will be resolved when the delete is finished
   */
  deleteSecureData (path, cb) {
    return doSecretAction(this._configuration, 'DELETE', path, undefined, cb)
  }

  /**
   * lists the keys under a secure data path.
   *
   * @param path The path or partial path
   * @param {function} [cb] callback, will be called when list is finished with the results
   * @return {Promise<object>} A promise that will be resolved when the list is finished supplying the results
   */
  listSecureData (path, cb) {
    return doSecretAction(this._configuration, 'LIST', path, undefined, cb)
  }

  /**
   * lists the files under a path.
   *
   * @param path The path or partial path
   * @param {function} [cb] callback, will be called when list is finished with the results
   * @return {Promise<object>} A promise that will be resolved when the list is finished supplying the results
   */
  listFile (path, cb) {
    return doFileAction(this._configuration, 'LIST', path, undefined, cb)
  }

  /**
   * Reads the contents of an uploaded file
   *
   * @param path The path the the uploaded file
   * @param {function} [cb] callback, will be called when the file contents have been fetched
   * @return {Promise<object>} A promise that will be resolved when the file contents have been fetched
   */
  readFile (path, cb) {
    return doFileAction(this._configuration, 'GET', path, undefined, cb)
  }

  /**
   * Uploads a file to a given path
   *
   * @param path The path
   * @param {function} [cb] callback, will be called when the file contents have been uploaded
   * @return {Promise<object>} A promise that will be resolved when the file contents have been uploaded
   */
  writeFile (path, data, cb) {
    return doFileAction(this._configuration, 'POST', path, data, cb)
  }

  /**
   * deletes an uploaded file
   *
   * @param path The path the the uploaded file
   * @param {function} [cb] callback, will be called when the file contents have been deleted
   * @return {Promise<object>} A promise that will be resolved when the file contents have been deleted
   */
  deleteFile (path, cb) {
    return doFileAction(this._configuration, 'DELETE', path, undefined, cb)
  }
}

/**
 * Performs an API action against the secret endpoint in Cerberus
 *
 * @private
 * @param context The Cerberus client configuration context
 * @param type The type of secret action
 * @param path The secure data path
 * @param body The post for writes
 * @param cb A call back to execute when finished
 * @return {Promise<*>} This method returns a promised that when resolved will supply the secure data.
 */
const doSecretAction = async (context, type, path, body, cb) => {
  context.log(`Starting ${type} request for ${path}`)
  const token = await getToken(context)
  const response = await executeCerberusRequest(context, {
    headers: Object.assign({}, globalHeaders, { 'X-Cerberus-Token': token }),
    method: type === 'LIST' ? 'GET' : type,
    url: urlJoin(context.hostUrl, cerberusVersion, 'secret', path) + (type === 'LIST' ? '?list=true' : '')
  })

  if (cb) {
    response
      .then(result => cb(null, result))
      .catch(err => cb(err))
  } else {
    return response.data
  }
}

/**
 * Executes a request against the Cerberus API dealing with any error cases.
 *
 * @private
 * @param context The Cerberus client configuration context
 * @param requestConfig The request configuration to be executed
 * @return {Promise<*>} The response JSON from Cerberus
 */
const executeCerberusRequest = async (context, requestConfig) => {
  let response
  try {
    response = await request(Object.assign({}, requestConfig, { json: true }))
  } catch (error) {
    context.log('There was an error executing a call to Cerberus.\nmsg: \'' + error.message + '\'')
  }

  if (!(response.statusCode >= 200 && response.statusCode < 300)) {
    if (response.headers['content-type'].startsWith('application/json')) {
      throw new Error(formatCerberusError(response.data.errors))
    } else {
      throw new Error('Cerberus returned a non success response that wasn\'t ' +
        'JSON, this is likely due to being blocked by the WAF')
    }
  }

  return response.data
}

/**
 * Upload, delete, read, and list files on Cerberus.
 *
 * @private
 * @param {object} context The request context
 * @param {string} type - The HTTP method (with the exception of 'LIST') to use as outlined in https://github.com/Nike-Inc/cerberus-management-service/blob/master/API.md
 * @param {string} filePath - The path of the file
 * @param {object} fileBuffer - Buffer of the file to upload
 * @param {function} cb - Callback
 * @returns {Promise<object>} Buffer if read file and Cerberus response otherwise
 */
const doFileAction = async (context, type, filePath, fileBuffer, cb) => {
  context.log(`Starting ${type} file request for ${filePath}`)
  const token = await getToken(context)
  let form
  if (fileBuffer) {
    form = new FormData({})
    form.append('file-content', fileBuffer, {filename: filePath.match(/([^\/]*)\/*$/)[1]})
  }

  const data = await executeCerberusRequest({
    method: type === 'LIST' ? 'GET' : type,
    url: urlJoin(context.hostUrl, cerberusVersion, type === 'LIST' ? 'secure-files' : 'secure-file', filePath),
    headers: Object.assign({}, globalHeaders, {'X-Vault-Token': token}, type === 'POST' ? form.getHeaders() : undefined),
    body: form,
    json: type === 'LIST' || type === 'DELETE'
  })

  if (cb) {
    data
      .then(result => cb(null, result))
      .catch(err => cb(err))
  } else {
    return data
  }
}

/**
 * Fetches a token either from a local env var or attempts to authenticate with Cerberus via the STS authentication endpoint.
 *
 * @private
 * @return {Promise<string>} when the promise is resolved the Cerberus auth token string is supplied.
 */
const getToken = async (context) => {
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

  let authResponse
  try {
    const authHeaders = await getAuthenticationHeaders(context.region ? context.region : 'us-west-2')
    authResponse = await executeCerberusRequest(context, {
      method: 'POST',
      url: urlJoin(context.hostUrl, 'v2/auth/sts-identity'),
      headers: Object.assign({}, globalHeaders, authHeaders)
    })
  } catch (error) {
    throw new Error('There was an issue trying to authenticate with Cerberus using the STS auth endpoint\nmsg: \'' + error.message + '\'')
  }

  // Expire 60 seconds before lease is up, to account for latency
  context.tokenExpiresAt = (Date.now() / 1000) + authResponse['lease_duration'] - 60  // token TTL in secs, Date.now in ms
  context.token = authResponse['client_token']
  return context.token
}

/**
 * Gets the set value or undefined
 *
 * @private
 * @param value The value under question
 * @return {String|undefined} Returns the string of the value or undefined
 */
function getEnvironmentVariable (value) {
  return value && value !== 'undefined' && value !== undefined && value !== null ? value : undefined
}

/**
 * Formats a Backstopper API error into a serialized string
 *
 * @private
 * @param errors The error response from Cerberus
 * @return {string} The serialized error
 */
const formatCerberusError = (errors) => {
  return errors instanceof Array
    ? errors.map(e => e.message || e).join(', ')
    : JSON.stringify(errors)
}

/**
 * Options for creating a {@link CerberusClient}
 * @interface CerberusClientOptions
 * @typedef CerberusClientOptions
 * @type {Object}
 * @property {string} hostUrl required base url for the Cerberus API.
 * @property {boolean} [debug] If set to true additional logging occurs.
 */

module.exports = CerberusClient
