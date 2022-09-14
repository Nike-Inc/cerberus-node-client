/* eslint-env jest */
const request = require('request-micro')
const CerberusClient = require('../index')
const packageData = require('../package.json')
const { log, noop } = require('../lib/log')
const sts = require('../lib/sts')

jest.mock('../lib/sts', () => ({
  getAuthenticationHeaders: jest.fn()
}))

jest
  .mock('request-micro', () => jest.fn())

/**
 * @type {CerberusClientOptions}
 */
const options = {
  hostUrl: 'https://demo.example.cerberus.com'
}

const baseSecretResponse = {
  request_id: 'f2c3e309dd28e4dd',
  lease_id: '',
  renewable: false,
  lease_duration: 3600,
  wrap_info: null,
  warnings: null,
  auth: null,
  metadata: {

  }
}

const stubToken = 'abc-123-def-456'

describe('The CerberusClient', () => {
  describe('when being instantiated', () => {
    afterEach(() => {
      process.env.CERBERUS_TOKEN = undefined
    })

    it('throws an error if options where omitted during construction', () => {
      expect(() => new CerberusClient(undefined)).toThrow(/options.*?required/)
    })

    it('throws an error if no hostUrl was supplied in the options', () => {
      expect(() => new CerberusClient({})).toThrow(/options.hostUrl/)
    })

    it('defaults to us-west-2', () => {
      const client = new CerberusClient(options)
      expect(client._region).toBe('us-west-2')
    })

    it('uses the region from the options if supplied', () => {
      const region = 'some-different-region'
      const client = new CerberusClient({
        hostUrl: 'some-url',
        region: region
      })
      expect(client._region).toBe(region)
    })

    it('uses debug logger if debug is enabled in options', () => {
      const client = new CerberusClient({
        hostUrl: 'some-url',
        debug: true
      })
      expect(client._log).toBe(log)
    })

    it('uses noop logger if debug is not enabled in options', () => {
      const client = new CerberusClient({
        hostUrl: 'some-url',
        debug: false
      })
      expect(client._log).toBe(noop)
    })

    it('should use the supplied options.token for the token if present', async () => {
      const fakeToken = 'abc-123'
      const client = new CerberusClient({ hostUrl: 'some-url', token: fakeToken })
      expect(await client._getToken()).toBe(fakeToken)
    })

    it('should use the supplied CERBERUS_TOKEN env var for the token if present', async () => {
      const fakeToken = 'abc-123'
      process.env.CERBERUS_TOKEN = fakeToken
      const client = new CerberusClient({ hostUrl: 'some-url' })
      expect(await client._getToken()).toBe(fakeToken)
    })

    it('should use the supplied options.token over CERBERUS_TOKEN env var for the token if both are provided', async () => {
      const fakeToken = 'abc-123'
      process.env.CERBERUS_TOKEN = 'not the token'
      const client = new CerberusClient({ hostUrl: 'some-url', token: fakeToken })
      expect(await client._getToken()).toBe(fakeToken)
    })
  })

  describe('when performing actions against the /v1/secret API', () => {
    let actualRequestConfig
    let stubResponse
    let responsePromise

    /**
     * @type {CerberusClient}
     */
    let cerberusClient

    afterEach(() => {
      actualRequestConfig = undefined
    })

    beforeEach(() => {
      responsePromise = new Promise(resolve => {
        stubResponse = resolve
      })
      cerberusClient = new CerberusClient(options)
      jest
        .spyOn(cerberusClient, '_getToken')
        .mockImplementation(() => {
          return stubToken
        })

      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation((requestConfig) => {
          actualRequestConfig = requestConfig
          return responsePromise
        })
    })

    it('executes a request and returns the data as expected when reading a secret', async () => {
      stubResponse({
        statusCode: 200,
        data: Object.assign({}, baseSecretResponse, { data: { foo: 'bar' } })
      })

      const secureData = await cerberusClient.getSecureData('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'GET',
        url: 'https://demo.example.cerberus.com/v1/secret/path',
        body: undefined,
        json: true
      })

      expect(secureData).toEqual({
        foo: 'bar'
      })
    })

    it('executes a request and returns the data as expected when listing a path', async () => {
      stubResponse({
        statusCode: 200,
        data: Object.assign({}, baseSecretResponse, { data: { keys: ['key1', 'key2', 'partialPath1/'] } })
      })

      const paths = await cerberusClient.listPathsForSecureData('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'GET',
        url: 'https://demo.example.cerberus.com/v1/secret/path?list=true',
        body: undefined,
        json: true
      })

      expect(paths).toEqual({
        keys: ['key1', 'key2', 'partialPath1/']
      })
    })

    it('executes a request and returns a valid ListKeyResult as expected when listing a path that has no keys', async () => {
      stubResponse({
        headers: {
          'content-type': 'application/json'
        },
        statusCode: 404,
        errors: []
      })

      const paths = await cerberusClient.listPathsForSecureData('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'GET',
        url: 'https://demo.example.cerberus.com/v1/secret/path?list=true',
        body: undefined,
        json: true
      })

      expect(paths).toEqual({
        keys: []
      })
    })

    it('re-throws when listing secure paths, when response error is not 404', () => {
      stubResponse({
        headers: {
          'content-type': 'application/json'
        },
        statusCode: 500,
        errors: []
      })
      expect(cerberusClient.listPathsForSecureData('path')).rejects.toThrow()
    })

    it('executes a request and returns the data as expected when writing a secret', async () => {
      stubResponse({
        statusCode: 204
      })

      const res = await cerberusClient.writeSecureData('path', { foo: 'bar' })

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        body: { foo: 'bar' },
        method: 'POST',
        url: 'https://demo.example.cerberus.com/v1/secret/path',
        json: true
      })

      expect(res).toBeUndefined()
    })

    it('executes a request and returns the data as expected when deleting a secret', async () => {
      stubResponse({
        statusCode: 204
      })

      const res = await cerberusClient.deleteSecureData('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'DELETE',
        url: 'https://demo.example.cerberus.com/v1/secret/path',
        body: undefined,
        json: true
      })

      expect(res).toBeUndefined()
    })
  })

  describe('when performing actions against the /v1/secure-file API', () => {
    let actualRequestConfig
    let stubResponse
    let responsePromise

    /**
     * @type {CerberusClient}
     */
    let cerberusClient

    afterEach(() => {
      actualRequestConfig = undefined
    })

    beforeEach(() => {
      responsePromise = new Promise(resolve => {
        stubResponse = resolve
      })
      cerberusClient = new CerberusClient(options)
      jest
        .spyOn(cerberusClient, '_getToken')
        .mockImplementation(() => {
          return stubToken
        })

      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation((requestConfig) => {
          actualRequestConfig = requestConfig
          return responsePromise
        })
    })

    it('executes a request and returns the data as expected when listing a path', async () => {
      const responseBody = {
        has_next: false,
        next_offset: null,
        limit: 1000,
        offset: 0,
        file_count_in_result: 1,
        total_file_count: 1,
        secure_file_summaries: [{
          sdbox_id: '123-456-78',
          path: 'keys/pkcs8-private-key.pem',
          size_in_bytes: 1725,
          name: 'pkcs8-private-key.peml',
          created_by: 'Justin.Field@example.com',
          created_ts: '2018-10-19T23:04:12.644Z',
          last_updated_by: 'Justin.Field@nike.com',
          last_updated_ts: '2018-11-02T21:21:38.722Z'
        }]
      }
      stubResponse({
        statusCode: 200,
        data: responseBody
      })

      const res = await cerberusClient.listFile('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'GET',
        url: 'https://demo.example.cerberus.com/v1/secure-files/path',
        body: undefined,
        json: true
      })

      expect(res).toEqual(responseBody)
    })

    it('executes a request and returns the data as expected when reading a file', async () => {
      const responseBody = `
-----BEGIN PRIVATE KEY-----
MIIEpAIBAAKCAQEApUBxvxcm2Ss2EtoEM903LBksjF4yTZK23kfmeeE5m6GPsWL8
kIgbznwEXu8Bki3gnh9Z0MoHwbKXpXNoJG3Y1Qq+fbZfCmF7kWHxizy4FwU2nMbq
pahho+V7X3W3JUZ87c+hD5H+C5Bu8lh1JWNOomZngbbIFbXVbGUzltFPytk5qnh8
gEJuJItEaPq6B6DYCXpuKRV1Sev5ZjH4fo5DQkCsMY9EEUFCCcCA5mwvWRpdJ0a/
-----END PRIVATE KEY-----
      `
      stubResponse({
        statusCode: 200,
        data: responseBody
      })

      const res = await cerberusClient.readFile('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'GET',
        url: 'https://demo.example.cerberus.com/v1/secure-file/path',
        body: undefined,
        json: false
      })

      expect(res).toEqual(responseBody)
    })

    it('executes a request and returns the data as expected when writing a file', async () => {
      const fileContents = Buffer.from(`
-----BEGIN PRIVATE KEY-----
MIIEpAIBAAKCAQEApUBxvxcm2Ss2EtoEM903LBksjF4yTZK23kfmeeE5m6GPsWL8
kIgbznwEXu8Bki3gnh9Z0MoHwbKXpXNoJG3Y1Qq+fbZfCmF7kWHxizy4FwU2nMbq
pahho+V7X3W3JUZ87c+hD5H+C5Bu8lh1JWNOomZngbbIFbXVbGUzltFPytk5qnh8
gEJuJItEaPq6B6DYCXpuKRV1Sev5ZjH4fo5DQkCsMY9EEUFCCcCA5mwvWRpdJ0a/
-----END PRIVATE KEY-----
      `)
      stubResponse({
        statusCode: 204
      })

      const res = await cerberusClient.writeFile('path', fileContents)

      expect(actualRequestConfig).toMatchObject({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'POST',
        url: 'https://demo.example.cerberus.com/v1/secure-file/path',
        json: false
      })

      expect(actualRequestConfig.body.constructor.name).toBe('FormData')

      expect(res).toBeUndefined()
    })

    it('executes a request and returns the data as expected when deleting a file', async () => {
      stubResponse({
        statusCode: 204
      })

      const res = await cerberusClient.deleteFile('path')

      expect(actualRequestConfig).toEqual({
        headers: {
          'X-Cerberus-Client': `CerberusNodeClient/${packageData.version}`,
          'X-Cerberus-Token': stubToken
        },
        method: 'DELETE',
        url: 'https://demo.example.cerberus.com/v1/secure-file/path',
        body: undefined,
        json: true
      })

      expect(res).toBeUndefined()
    })
  })

  describe('handles errors gracefully', () => {
    /**
     * @type {CerberusClient}
     */
    let cerberusClient

    beforeEach(() => {
      cerberusClient = new CerberusClient(options)
    })

    it('gets an undefined response', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => { return undefined })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/No response was returned from Cerberus/)
    })

    it('when the request library throws an error', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          throw new Error('something went wrong')
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects
        .toThrow(/There was an error executing a call to Cerberus/)
    })

    it('when Cerberus returns a Backstopper error with multiple errors', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 400,
            data: {
              error_id: 'ccc1cc1c-e111-11e1-11ce-111e11a111f1',
              errors: [
                {
                  code: 99106,
                  message: 'some message'
                },
                {
                  code: 99108,
                  message: 'some other message'
                }
              ]
            }
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned an error/)
    })

    it('when Cerberus returns a Backstopper error with a single errors', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 400,
            data: {
              error_id: 'ccc1cc1c-e111-11e1-11ce-111e11a111f1',
              errors: [
                {
                  code: 99106,
                  message: 'some message'
                }
              ]
            }
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned an error/)
    })

    it('when Cerberus returns a Backstopper error with no errors', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 400,
            data: {
              error_id: 'ccc1cc1c-e111-11e1-11ce-111e11a111f1',
              errors: []
            }
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned an error/)
    })

    it('when Cerberus returns a legacy Vault style error', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 400,
            data: {
              errors: [
                'permission denied'
              ]
            }
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned an error/)
    })

    it('when Cerberus returns a legacy Vault style error, empty list', async () => {
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 400,
            data: {
              errors: []
            }
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned an error/)
    })

    it('when the WAF returns an error', async () => {
      const html = `
<html>
<header><title>This is title</title></header>
<body>
Hello world
</body>
</html>
`
      jest
        .spyOn(cerberusClient, '_executeRequest')
        .mockImplementation(() => {
          return {
            headers: {
              'content-type': 'text/html; charset=UTF-8'
            },
            statusCode: 403,
            data: html
          }
        })

      await expect(cerberusClient._executeCerberusRequest({})).rejects.toThrow(/Cerberus returned a non-success response that wasn't JSON/)
    })
  })

  describe('manages the auth token state and', () => {
    /**
     * @type {CerberusClient}
     */
    let cerberusClient

    beforeEach(() => {
      cerberusClient = new CerberusClient(options)
    })

    afterEach(() => {
      sts.getAuthenticationHeaders.mockReset()
    })

    it('clears the stored token, if it has expired and fetches a new token', async () => {
      const newToken = 'new-token'
      cerberusClient._token = stubToken
      cerberusClient._tokenExpiresAt = (new Date() / 1000) - 5000
      sts.getAuthenticationHeaders.mockReturnValue({
        'X-Fake-Auth-Header': 'signed-value'
      })
      jest
        .spyOn(cerberusClient, '_executeCerberusRequest')
        .mockImplementation(() => {
          return {
            client_token: newToken,
            lease_duration: 3600,
            metadata: {
              aws_iam_principal_arn: 'arn:aws:iam::111111111111:role/role'
            }
          }
        })
      expect(await cerberusClient._getToken()).toBe(newToken)
      expect(sts.getAuthenticationHeaders.mock.calls.length).toBe(1)
    })

    it('clears the stored token, if it has expired and fetches a new token for user auth', async () => {
      const newToken = 'new-token'
      cerberusClient._token = stubToken
      cerberusClient._tokenExpiresAt = (new Date() / 1000) - 5000
      sts.getAuthenticationHeaders.mockReturnValue({
        'X-Fake-Auth-Header': 'signed-value'
      })
      jest
        .spyOn(cerberusClient, '_executeCerberusRequest')
        .mockImplementation(() => {
          return {
            client_token: newToken,
            lease_duration: 3600,
            metadata: {
              username: 'test_user'
            }
          }
        })
      expect(await cerberusClient._getToken()).toBe(newToken)
      expect(sts.getAuthenticationHeaders.mock.calls.length).toBe(1)
    })

    it('returns a stored token if it is not expired', async () => {
      const newToken = 'new-token'
      cerberusClient._token = stubToken
      cerberusClient._tokenExpiresAt = (new Date() / 1000) + 50000
      sts.getAuthenticationHeaders.mockReturnValue({
        'X-Fake-Auth-Header': 'signed-value'
      })
      jest
        .spyOn(cerberusClient, '_executeCerberusRequest')
        .mockImplementation(() => {
          return {
            client_token: newToken,
            lease_duration: 3600
          }
        })
      expect(await cerberusClient._getToken()).toBe(stubToken)
      expect(sts.getAuthenticationHeaders.mock.calls.length).toBe(0)
    })

    it('throws an error message if credentials cannot be found', async () => {
      sts.getAuthenticationHeaders.mockImplementation(() => {
        throw new Error('Failed to get signed headers')
      })
      await expect(cerberusClient._getToken()).rejects.toThrow(/There was an issue trying to authenticate with Cerberus/)
      expect(sts.getAuthenticationHeaders.mock.calls.length).toBe(1)
    })
    describe('_executeRequest', () => {
      afterEach(() => {
        request.mockReset()
      })
      it('makes the call to the actual request library', async () => {
        await cerberusClient._executeRequest()
        expect(request).toHaveBeenCalled()
      })

      it('when the request gets retried', async () => {
        request.mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 500,
            data: {
              error_id: 'ccc1cc1c-e111-11e1-11ce-111e11a111f1',
              errors: [
                {
                  code: 99106,
                  message: 'some message'
                }
              ]
            }
          }
        })
        await cerberusClient._executeRequest()
        expect(request).toBeCalledTimes(3)
      })

      it('when the request succeeds', async () => {
        request.mockImplementation(() => {
          return {
            headers: {
              'content-type': 'application/json'
            },
            statusCode: 200,
            data: Object.assign({}, baseSecretResponse, { data: { foo: 'bar' } })
          }
        })
        await cerberusClient._executeRequest()
        expect(request).toBeCalledTimes(1)
      })
    })
  })
})
