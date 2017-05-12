'use strict'

// Configuration
//
let sinon = require('sinon')
let test = require('blue-tape')
let http = require('http')

let linereader = require('../lib/linereader')
let lambda = require('../lib/lambda')
let kms = require('../lib/kms')
let cerberus = require('../index')

let testPort = process.env.TEST_PORT || 3032
let cerberusHost = 'http://localhost:' + testPort

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
  auth_data: new Buffer('test').toString('base64')
}
let defaultToken = {
  'client_token': Math.floor(Math.random() * (1e6 + 1)),
  'lease_duration': 1,
  'renewable': 'true'
}
let lambdaContext = {
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:1234567890:function:NU-cerberus-test'
}
let lambdaConfiguration = {
  'FunctionName': 'NU-cerberus-test',
  'FunctionArn': 'arn:aws:lambda:us-east-1:123456789:function:NU-cerberus-test',
  'Role': 'arn:aws:iam::123456789:role/lambda_basic_execution',
  'Description': 'Test lambda for NU-cerberus'
}

let mockCerberusHost = (action, handlerOrValue) => {
  mockCalls.length = 0
  return new Promise((resolve, reject) => {
    let defaultHandler = (req, res) => {
      let result = typeof handlerOrValue !== 'function' && handlerOrValue !== undefined ? handlerOrValue : defaultCerberusResponse
      // console.log(trimRequest(req))
      mockCalls.push({req: trimRequest(req), result})
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
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

test('Apps put', spec => {
  let sandbox
  let lineReaderUser = null
  let lineReaderPassword = null
  let lineReaderMfa = null
  let lambdaResult = null
  let lambdaStub = null
  let ksmResult = null
  let setup = () => {
    lambdaResult = lambdaConfiguration
    ksmResult = defaultToken
    sandbox = sinon.sandbox.create()
    sandbox.stub(linereader, 'readLine')
      .onCall(0).resolves(lineReaderUser)
      .onCall(1).resolves(lineReaderPassword)
      .onCall(2).resolves(lineReaderMfa)
      .rejects('too many calls to linereader')
    lambdaStub = sandbox.stub(lambda, 'getFunctionConfiguration').resolves(lambdaResult)
    sandbox.stub(kms, 'decrypt').resolves(ksmResult)
  }
  let teardown = () => {
    sandbox.restore()
    lineReaderUser = null
    lineReaderPassword = null
    lineReaderMfa = null
    lambdaResult = null
    ksmResult = null
  }
  let teardownError = (err) => {
    teardown()
    return Promise.reject(err)
  }

  spec.test('module loads', t => {
    t.ok(cerberus, 'module loaded')
    t.end()
  })

  spec.test('verifies options', t => {
    t.throws(() => cerberus(), /options parameter/, 'requires options')
    t.throws(() => cerberus({ aws: {} }), /options.hostUrl/, 'requires hostUrl')
    t.end()
  })

  spec.test('uses environment variable for token when present', t => {
    let original = process.env.CERBERUS_TOKEN
    let testToken = 'test token'
    process.env.CERBERUS_TOKEN = testToken
    let client = cerberus({ hostUrl: cerberusHost, debug: false })
    setup()

    return mockCerberusHost(() => client.get('test'))
      .then(() => {
        t.equal(mockCalls[0].req.headers['x-vault-token'], testToken, 'Vault header uses CERBERUS_TOKEN')
        process.env.CERBERUS_TOKEN = original
      })
      .then(teardown, teardownError)
  })

  spec.test('uses environment variable for hostUrl when present', t => {
    let original = process.env.CERBERUS_ADDR
    process.env.CERBERUS_ADDR = cerberusHost
    let client = cerberus({ lambdaContext, debug: false })

    setup()
    t.plan(1)

    return mockCerberusHost(() => client.get('test'))
      .then(result => {
        process.env.CERBERUS_ADDR = original
        t.ok(mockCalls.length, 'http called')
      })
      .then(teardown, teardownError)
  })

  spec.test('uses lambdaContext from constructor', t => {
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
    setup()
    t.plan(2)

    return mockCerberusHost(() => client.get('test'))
      .then(result => {
        t.ok(lambdaStub.called, 'lambda was called')
        t.ok(mockCalls.length, 'http called')
      })
      .then(teardown, teardownError)
  })

  spec.test('uses lambdaContext from setLambdaContext', t => {
    let client = cerberus({ hostUrl: cerberusHost })
    client.setLambdaContext(lambdaContext)

    setup()
    t.plan(2)

    return mockCerberusHost(() => client.get('test'))
      .then(result => {
        t.ok(lambdaStub.called, 'lambda was called')
        t.ok(mockCalls.length, 'http called')
      })
      .catch(err => {
        t.comment(err)
        t.fail('error from cerberus')
      })
      .then(teardown, teardownError)
  })

  spec.test('Prompt flow prompts if config option is set and other methods fail', t => {
    process.env.CERBERUS_TOKEN = undefined
    t.plan(2) // the 2nd assertion is present to ensure the http server closes before the test completes

    let client = cerberus({ hostUrl: cerberusHost, lambdaContext, prompt: true, debug: false })

    lineReaderUser = 'user'
    lineReaderPassword = 'password'
    setup()

    const action = () => client.get('test')
    const handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url.indexOf('auth/user') !== -1) {
        t.equal('Basic ' + new Buffer('user:password').toString('base64'), req.headers.authorization, 'sent prompted credentials')
        res.end(JSON.stringify({ data: { client_token: defaultToken } }))
      } else {
        res.end(JSON.stringify(defaultCerberusResponse))
      }
    }

    return mockCerberusHost(action, handler)
      .then(result => {
        t.pass('letting the promise finish so the server can close properly')
      })
      .then(teardown, teardownError)
  })

  spec.test('If request returns an errors array treat it like an error in the post-getToken flow', t => {
    process.env.CERBERUS_TOKEN = defaultToken
    let client = cerberus({ hostUrl: cerberusHost, aws: {} })

    setup()

    const action = () => client.put('some/test/path', 'System expects a JSON object, not a string, this should fail')
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
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.get('test'), { error_id: 'f887ba2a-d104-4323-93e0-d22304932f56', errors: [ { code: 99216, message: 'The specified IAM role is not valid.' } ] })
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
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.get('test'), { error_id: 'f887ba2a-d104-4323-93e0-d22304932f56', errors: [ { code: 3243, message: 'Key request failure' } ] })
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
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })

    t.plan(1)

    return mockCerberusHost(() => client.get('test'), { data: { success: 'someKey' } })
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

  spec.test('If cerberus returns 404 response return error', t => {
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
    setup()
    t.plan(1)

    let handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      let result
      mockCalls.push({req: trimRequest(req), result})
      if (req.url === '/v1/auth/iam-role') {
        result = defaultCerberusResponse
      } else {
        result = { errors: [] }
        res.statusCode = 404
      }
      res.end(JSON.stringify(result))
    }

    return mockCerberusHost(() => client.get('test'), handler)
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
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
    setup()
    t.plan(1)

    return mockCerberusHost(() => client.get('test'), {})
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
    let client = cerberus({ lambdaContext, hostUrl: cerberusHost })
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
      client.get('test', (err, result) => {
        server.close()
        t.comment(err)
        t.ok(/cannot decrypt token/.test(err && err.message), 'error from auth result')
        teardown()
        t.end()
      })
    })
  })



})




