'use strict'

// Configuration
//
let sinon = require('sinon')
let test = require('blue-tape')
let http = require('http')
let Buffer = require('safe-buffer').Buffer

let CerberusClient = require('../index')

let testPort = process.env.TEST_PORT || 3032
let cerberusHost = 'http://localhost:' + testPort

var log = (...args) => console.log(...args.map(a => require('util').inspect(a, { colors: true, depth: null }))) // eslint-disable-line

let mockCalls = []
function trimRequest (req) {
  return {
    headers: req.headers,
    path: req.url,
    method: req.method,
    body: req.body
  }
}
let defaultCerberusResponse = {
  auth_data: Buffer.from('test').toString('base64')
}
let defaultToken = {
  'client_token': Math.floor(Math.random() * (1e6 + 1)),
  'lease_duration': 1,
  'renewable': 'true'
}

let mockCerberusHost = (action, handlerOrValue) => {
  mockCalls.length = 0
  return new Promise((resolve, reject) => {
    let defaultHandler = (req, res) => {
      let result = typeof handlerOrValue !== 'function' && handlerOrValue !== undefined ? handlerOrValue : defaultCerberusResponse
      // console.log(trimRequest(req))
      mockCalls.push({req: trimRequest(req), result})
      res.setHeader('Content-Type', 'application/json')
      if (Buffer.isBuffer(result)) {
        res.end(result)
      } else {
        res.end(JSON.stringify(result))
      }
    }

    let server = http.createServer(typeof handlerOrValue === 'function' ? handlerOrValue : defaultHandler)
    server.listen(testPort, () => {
      action()
        .catch(err => {
          // console.log('error handling http action', err, mockCalls)
          server.close()
          reject(err)
        })
        .then((result) => {
          server.close()
          resolve(result)
        })
    })
  })
}

test('Cerberus Client', spec => {
  let sandbox
  let setup = () => {
    sandbox = sinon.sandbox.create()
  }
  let teardown = () => {
    sandbox.restore()
  }
  let teardownError = (err) => {
    teardown()
    return Promise.reject(err)
  }

  spec.test('module loads', t => {
    t.ok(CerberusClient, 'module loaded')
    t.end()
  })

  spec.test('verifies options', t => {
    t.throws(() => new CerberusClient(), /options parameter/, 'requires options')
    t.throws(() => new CerberusClient({ aws: {} }), /options.hostUrl/, 'requires hostUrl')
    t.end()
  })

  spec.test('uses environment variable for token when present', t => {
    let original = process.env.CERBERUS_TOKEN
    let testToken = 'test token'
    process.env.CERBERUS_TOKEN = testToken
    let client = new CerberusClient({ hostUrl: cerberusHost, debug: false })
    setup()

    return mockCerberusHost(() => client.getSecureData('test'))
      .then(() => {
        t.equal(mockCalls[0].req.headers['x-cerberus-token'], testToken, 'Cerberus Auth Token header uses CERBERUS_TOKEN')
        process.env.CERBERUS_TOKEN = original
      })
      .then(teardown, teardownError)
  })

  spec.test('If request returns an errors array treat it like an error in the post-getToken flow', t => {
    process.env.CERBERUS_TOKEN = defaultToken
    let client = new CerberusClient({ hostUrl: cerberusHost })

    setup()

    const action = () => client.writeSecureData('some/test/path', 'System expects a JSON object, not a string, this should fail')
    const handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ errors: [ 'Failed to parse JSON input: json: cannot unmarshal string into Go value of type map[string]interface {}' ] }))
    }

    return mockCerberusHost(action, handler)
      .then(result => {
        t.fail('The call should not succeed')
        process.env.CERBERUS_TOKEN = undefined
      })
      .catch(reason => {
        process.env.CERBERUS_TOKEN = undefined
        t.ok(reason.toString().indexOf('Failed to parse JSON input: json: cannot unmarshal string into Go value of type map[string]interface {}') !== 0, 'returns error')
      })
      .then(teardown, teardownError)
  })

  spec.test('If cerberus returns error from auth response return error', t => {
    let client = new CerberusClient({ hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.getSecureData('test'), { error_id: 'f887ba2a-d104-4323-93e0-d22304932f56', errors: [ { code: 99216, message: 'The specified IAM role is not valid.' } ] })
      .then(result => {
        console.log('test result', result)
        t.fail()
      })
      .catch(error => {
        // t.comment(error)
        t.ok(/IAM role is not valid/.test(error && error.message), 'error from auth result')
      })
      .then(teardown, teardownError)
  })

  spec.test('If cerberus returns error from key response return error', t => {
    process.env.CERBERUS_TOKEN = 'testToken'
    let client = new CerberusClient({ hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.getSecureData('test'), { error_id: 'f887ba2a-d104-4323-93e0-d22304932f56', errors: [ { code: 3243, message: 'Key request failure' } ] })
      .then(result => {
        process.env.CERBERUS_TOKEN = undefined
        console.log('test result', result)
        t.fail()
      })
      .catch(error => {
        process.env.CERBERUS_TOKEN = undefined
        // console.log('error caught', error)
        t.ok(/Key request failure/.test(error && error.message), 'key request raised promise error')
      })
      .then(teardown, teardownError)
  })

  spec.test('Get key should work', t => {
    process.env.CERBERUS_TOKEN = 'testToken'
    let client = new CerberusClient({ hostUrl: cerberusHost })

    t.plan(1)

    return mockCerberusHost(() => client.getSecureData('test'), { data: { success: 'someKey' } })
      .then(result => {
        process.env.CERBERUS_TOKEN = undefined
        t.same(result, { success: 'someKey' }, 'key returned')
      })
      .catch(error => {
        process.env.CERBERUS_TOKEN = undefined
        console.log('error caught', error)
        t.fail()
        // t.ok(/IAM role is not valid/.test(error && error.message), 'error from auth result')
      })
      .then(teardown, teardownError)
  })

  spec.test('Get file should work', t => {
    process.env.CERBERUS_TOKEN = 'testToken'
    let client = new CerberusClient({ hostUrl: cerberusHost })

    t.plan(1)

    return mockCerberusHost(() => client.readFile('test'), Buffer.from('file content'))
      .then(result => {
        t.same(result.toString(), 'file content', 'file returned')
      })
      .catch(error => {
        process.env.CERBERUS_TOKEN = undefined
        console.log('error caught', error)
        t.fail()
      })
      .then(teardown, teardownError)
  })

  spec.test('should send package version', t => {
    process.env.CERBERUS_TOKEN = 'testToken'
    let packageData = require('../package.json')
    let client = new CerberusClient({ hostUrl: cerberusHost })

    t.plan(1)

    return mockCerberusHost(() => client.getSecureData('test'), { data: { success: 'someKey' } })
      .then(result => {
        process.env.CERBERUS_TOKEN = undefined
        t.equal(mockCalls[0].req.headers['x-cerberus-client'], `CerberusNodeClient/${packageData.version}`, 'version is sent to cerbeurs')
      })
      .catch(error => {
        process.env.CERBERUS_TOKEN = undefined
        console.log('error caught', error)
        t.fail()
        // t.ok(/IAM role is not valid/.test(error && error.message), 'error from auth result')
      })
      .then(teardown, teardownError)
  })

  spec.test('If cerberus returns 404 response return error', t => {
    let client = new CerberusClient({ hostUrl: cerberusHost })
    setup()
    t.plan(1)

    let handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      let result
      mockCalls.push({req: trimRequest(req), result})
      if (req.url === '/v2/auth/iam-principal') {
        result = defaultCerberusResponse
      } else {
        result = { errors: [] }
        res.statusCode = 404
      }
      res.end(JSON.stringify(result))
    }

    return mockCerberusHost(() => client.getSecureData('test'), handler)
      .then(result => {
        console.log('test result', result)
        t.fail()
      })
      .catch(error => {
        t.ok(/Status: 404/.test(error && error.message), 'error from auth result')
      })
      .then(teardown, teardownError)
  })

  spec.test('If cerberus returns empty response return error', t => {
    let client = new CerberusClient({ hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.getSecureData('test'), {})
      .then(result => {
        console.log('test result', result)
        t.fail()
      })
      .catch(error => {
        t.comment(error)
        t.ok(/cannot decrypt token/.test(error && error.message), 'error from auth result')
      })
      .then(teardown, teardownError)
  })

  spec.test('If cerberus returns empty response return error using callbacks', t => {
    let client = new CerberusClient({ hostUrl: cerberusHost })
    setup()

    t.plan(1)
    mockCalls.length = 0
    let server = http.createServer((req, res) => {
      let result = {}
      // console.log(req)
      mockCalls.push({req: trimRequest(req), result})
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })

    server.listen(testPort, () => {
      client.getSecureData('test', (err, result) => {
        server.close()
        t.comment(err)
        t.ok(/cannot decrypt token/.test(err && err.message), 'error from auth result')
        teardown()
        t.end()
      })
    })
  })
})
