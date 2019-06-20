'use strict'

const request = require('request-micro')
const urlJoin = require('url-join')
const FormData = require('form-data')
const packageData = require('./package.json')
const { getAuthenticationHeaders } = require('./lib/sts')
const { log, noop } = require('./lib/log')

const globalHeaders = {
  'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`
}

const cerberusVersion = 'v1'

/**
 * Options for creating a {@link CerberusClient}
 * @interface CerberusClientOptions
 * @typedef CerberusClientOptions
 * @type {object}
 * @property {string} hostUrl required base url for the Cerberus API.
 * @property {string} [region] region to sign sts auth request for, defaults to us-west-2
 * @property {string} [token] Override the cerberus token. Useful for testing
 * @property {boolean} [debug] If set to true additional logging occurs.
 */

/**
 * @interface ListKeyResult
 * @typedef ListKeyResult
 * @type {object}
 * @property {array<string>} keys
 */

/**
 * @interface ListFileResult
 * @typedef ListFileResult
 * @type {object}
 * @property {boolean} has_next If the result requires pagination
 * @property {string} next_offset The offset to use for the next page
 * @property {number} limit The limit that was used for the results
 * @property {number} offset The offset of the results
 * @property {number} file_count_in_result Number of files in result
 * @property {number} total_file_count Number of total files under path
 * @property {array<SecureFileSummaries>} secure_file_summaries
 */

/**
 * @interface SecureFileSummaries
 * @typedef SecureFileSummaries
 * @type {object}
 * @property {string} sdbox_id The SDB id
 * @property {string} path The path for the file
 * @property {number} size_in_bytes The size in bytes of the file
 * @property {string} name The name of the file
 * @property {string} created_by Who originally uploaded the file
 * @property {string} created_ts ISO 8061 String of when the file was originally uploaded
 * @property {string} last_updated_by Who last updated the file
 * @property {string} last_updated_ts ISO 8061 String of when the file was last updated
 */

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
    this._log = options.debug ? log : noop

    if (options.token) {
      this._log('constructor options token found', options.token)
      this._token = options.token
    } else {
      // Override context with env variables
      let envToken = getEnvironmentVariable(process.env.CERBERUS_TOKEN)
      if (envToken) {
        this._log('environment variable token found', envToken)
        this._token = envToken
      }
    }

    // Validate configuration
    if (typeof options.hostUrl !== 'string') {
      throw new Error('options.hostUrl must be a URL string')
    }

    this._hostUrl = options.hostUrl
    this._region = options.region ? options.region : 'us-west-2'
  }

  /**
   * Fetches secure data.
   *
   * @param {string} path The path for the secure data
   * @return {Promise<object>} A promise that when resolved supplies the secure data
   */
  getSecureData (path) {
    return this._doSecretAction('GET', path, undefined)
  }

  /**
   * Writes secure data.
   *
   * @param {string} path The path for the secure data
   * @param {object} data The secure data
   * @return {Promise<undefined>} A promise that will be resolved when the write is finished
   */
  writeSecureData (path, data) {
    return this._doSecretAction('POST', path, data)
  }

  /**
   * Deletes secure data.
   *
   * @param {string} path The path for the secure data
   * @return {Promise<object>} A promise that will be resolved when the delete is finished
   */
  deleteSecureData (path) {
    return this._doSecretAction('DELETE', path, undefined)
  }

  /**
   * lists the keys under a secure data path.
   *
   * If no keys are present {ListKeyResult} will have an empty array.
   *
   * @param {string} path The path or partial path
   * @return {Promise<ListKeyResult>} A promise that will be resolved when the list is finished supplying the results
   */
  async listPathsForSecureData (path) {
    let res
    try {
      res = await this._doSecretAction('LIST', path, undefined)
    } catch (e) {
      // If no keys under a partial path can be found the API returns a 404, lets convert that to set of empty keys
      if (e.message.includes('status code: 404')) {
        res = {keys: []}
      } else {
        throw e
      }
    }
    return res
  }

  /**
   * lists the files under a path.
   *
   * @param {string} path The path or partial path
   * @return {Promise<ListFileResult>} A promise that will be resolved when the list is finished supplying the {ListFileResult}
   */
  listFile (path) {
    return this._doFileAction('LIST', path, undefined)
  }

  /**
   * Reads the contents of an uploaded file
   *
   * @param {string} path The path the the uploaded file
   * @return {Promise<Buffer|string>} A promise that will be resolved when the file contents have been fetched
   */
  readFile (path) {
    return this._doFileAction('GET', path, undefined)
  }

  /**
   * Uploads a file to a given path
   *
   * @param {string} path The path
   * @param {string|Buffer} data The file buffer or string
   * @return {Promise<object>} A promise that will be resolved when the file contents have been uploaded
   */
  writeFile (path, data) {
    return this._doFileAction('POST', path, data)
  }

  /**
   * deletes an uploaded file
   *
   * @param {string} path The path the the uploaded file
   * @return {Promise<object>} A promise that will be resolved when the file contents have been deleted
   */
  deleteFile (path) {
    return this._doFileAction('DELETE', path, undefined)
  }

  /**
   * Performs an API action against the secret endpoint in Cerberus
   *
   * @param type The type of secret action
   * @param {string} path The secure data path
   * @param body The post for writes
   * @return {Promise<*>} This method returns a promised that when resolved will supply the secure data.
   * @private
   */
  async _doSecretAction (type, path, body) {
    this._log(`Starting ${type} request for ${path}`)
    const token = await this._getToken()
    const response = await this._executeCerberusRequest({
      headers: Object.assign({}, globalHeaders, { 'X-Cerberus-Token': token }),
      method: type === 'LIST' ? 'GET' : type,
      url: urlJoin(this._hostUrl, cerberusVersion, 'secret', path) + (type === 'LIST' ? '?list=true' : ''),
      body: body
    })

    return response ? response.data : undefined
  }

  /**
   * Executes a request against the Cerberus API dealing with any error cases.
   *
   * @param requestConfig The request configuration to be executed
   * @return {Promise<*>} The response body from Cerberus
   * @private
   */
  async _executeCerberusRequest (requestConfig) {
    let response
    try {
      response = await this._executeRequest(Object.assign({}, { json: true }, requestConfig))
    } catch (error) {
      const msg = 'There was an error executing a call to Cerberus.\nmsg: \'' + error.message + '\''
      this._log(msg)
      throw new Error(msg)
    }

    if (!(response.statusCode >= 200 && response.statusCode < 300)) {
      if (response.headers['content-type'].startsWith('application/json')) {
        throw new Error(`Cerberus returned an error, when executing a call.\nstatus code: ${response.statusCode}\nmsg: ${JSON.stringify(response.data)}`)
      } else {
        throw new Error('Cerberus returned a non-success response that wasn\'t JSON' +
          ', this is likely due to being blocked by the WAF')
      }
    }

    return response.data
  }

  // noinspection JSMethodCanBeStatic
  /**
   * Uses the micro request library to execute the request
   * @param requestConfig
   * @return {promise<*>}
   * @private
   */
  _executeRequest (requestConfig) {
    return request(requestConfig)
  }

  /**
   * Upload, delete, read, and list files on Cerberus.
   *
   * @param {string} type - The HTTP method (with the exception of 'LIST') to use as outlined in https://github.com/Nike-Inc/cerberus-management-service/blob/master/API.md
   * @param {string} filePath - The path of the file
   * @param {string|Buffer} fileBuffer - Buffer of the file to upload
   * @returns {Promise<object>} Buffer if read file and Cerberus response otherwise
   * @private
   */
  async _doFileAction (type, filePath, fileBuffer) {
    this._log(`Starting ${type} file request for ${filePath}`)
    const token = await this._getToken()
    let form
    if (fileBuffer) {
      form = new FormData({})
      form.append('file-content', fileBuffer, {filename: filePath.match(/([^\/]*)\/*$/)[1]})
    }

    const data = await this._executeCerberusRequest({
      method: type === 'LIST' ? 'GET' : type,
      url: urlJoin(this._hostUrl, cerberusVersion, type === 'LIST' ? 'secure-files' : 'secure-file', filePath),
      headers: Object.assign({}, globalHeaders, {'X-Cerberus-Token': token}, type === 'POST' ? form.getHeaders() : undefined),
      body: form,
      json: type === 'LIST' || type === 'DELETE'
    })

    return data
  }

  /**
   * Fetches a token either from a local env var or attempts to authenticate with Cerberus via the STS authentication endpoint.
   *
   * @return {Promise<string>} when the promise is resolved the Cerberus auth token string is supplied.
   * @private
   */
  async _getToken () {
    // tokenExpiresAt in secs, Date.now in ms
    if (this._tokenExpiresAt && (this._tokenExpiresAt <= (Date.now() / 1000))) {
      this._tokenExpiresAt = null
      this._token = null
    }

    // Already has token
    if (this._token) {
      this._log('returning stored token')
      return this._token
    }

    let authResponse
    try {
      const authHeaders = await getAuthenticationHeaders(this._region)
      authResponse = await this._executeCerberusRequest({
        method: 'POST',
        url: urlJoin(this._hostUrl, 'v2/auth/sts-identity'),
        headers: Object.assign({}, globalHeaders, authHeaders)
      })
    } catch (error) {
      throw new Error('There was an issue trying to authenticate with Cerberus using the STS auth endpoint\nmsg: \'' + error.message + '\'')
    }

    // Expire 60 seconds before lease is up, to account for latency
    this._tokenExpiresAt = (Date.now() / 1000) + authResponse['lease_duration'] - 60  // token TTL in secs, Date.now in ms
    this._token = authResponse['client_token']
    return this._token
  }
}

/**
 * Gets the set value or undefined
 *
 * @param value The value under question
 * @return {String|undefined} Returns the string of the value or undefined
 * @private
 */
const getEnvironmentVariable = (value) => {
  return value && value !== 'undefined' && value !== undefined && value !== null ? value : undefined
}

module.exports = CerberusClient
