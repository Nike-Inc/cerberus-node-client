'use strict'

// Configuration
//

var test = require('blue-tape')
var linereader = require('../lib/linereader')

var linereads = []
linereader.readLine = (options, cb) => cb(null, linereads.shift())

var http = require('http')
var cerberus = require('../index')
var testPort = process.env.TEST_PORT || 3032
var cerberusHost = 'http://localhost:' + testPort

var mockCalls = []
function trimRequest (req) {
  return {
    headers: req.headers,
    path: req.url,
    method: req.method,
    body: req.body
  }
}
var defaultCerberusResponse = {
  auth_data: new Buffer('test').toString('base64')
}
var defaultToken = {
  'client_token': Math.floor(Math.random() * (1e6 + 1)),
  'lease_duration': 1,
  'renewable': 'true'
}
var mockHttp = (action, handlerOrValue) => {
  mockCalls.length = 0
  return new Promise((resolve, reject) => {
    var defaultHandler = (req, res) => {
      var result = typeof handlerOrValue !== 'function' && handlerOrValue !== undefined ? handlerOrValue : defaultCerberusResponse
      // console.log(trimRequest(req))
      mockCalls.push({req: trimRequest(req), result})
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    }

    var server = http.createServer(typeof handlerOrValue === 'function' ? handlerOrValue : defaultHandler)
    server.listen(testPort, () => {
      Promise.resolve(action())
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

var lambdaContext = {
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:1234567890:function:NU-cerberus-test'
}
var lambdaConfiguration = {
  'FunctionName': 'NU-cerberus-test',
  'FunctionArn': 'arn:aws:lambda:us-east-1:123456789:function:NU-cerberus-test',
  'Role': 'arn:aws:iam::123456789:role/lambda_basic_execution',
  'Description': 'Test lambda for NU-cerberus'
}
var throwErr
var aws = {
  Lambda: function (stuff) {
    return {
      getFunctionConfiguration: (params, cb) => {
        switch (throwErr) {
          case 'auth': return cb({stack: 'some stack'}, null)
        }
        return cb(null, lambdaConfiguration)
      }
    }
  },
  KMS: function (stuff) {
    return {
      decrypt: (text, cb) => {
        switch (throwErr) {
          case 'auth_data': return cb({stack: 'some stack'}, null)
          case 'parse_err': return cb(null, 'parse fail')
        }

        return cb(null, {
          Plaintext: JSON.stringify(defaultToken)
        })
      }
    }
  },
  config: {
    region: 'us-east-1'
  }
}

// Tests
//

test('module loads', t => {
  t.ok(cerberus, 'module loaded')
  t.end()
})

test('verifies options', t => {
  t.throws(() => cerberus(), /options parameter/, 'requires options')
  t.throws(() => cerberus({}), /options.aws/, 'requires aws')
  t.throws(() => cerberus({ aws: 1 }), /options.aws/, 'requires aws object')
  t.throws(() => cerberus({ aws: {} }), /options.hostUrl/, 'requires hostUrl')
  t.end()
})

test('uses environment variable for token when present', t => {
  var original = process.env.CERBERUS_TOKEN
  var testToken = 'test token'
  process.env.CERBERUS_TOKEN = testToken
  var client = cerberus({ hostUrl: cerberusHost, aws: {} })

  mockHttp(() => client.get('test'))
    .then(() => {
      t.equal(mockCalls[0].req.headers['x-vault-token'], testToken, 'Vault header uses CERBERUS_TOKEN')
      process.env.CERBERUS_TOKEN = original
      t.end()
    })
})

test('uses environment variable for hostUrl when present', t => {
  var original = process.env.CERBERUS_ADDR
  process.env.CERBERUS_ADDR = cerberusHost
  var client = cerberus({ aws: aws, lambdaContext })

  t.plan(1)

  mockHttp(() => client.get('test'))
    .then(result => {
      process.env.CERBERUS_ADDR = original
      t.ok(mockCalls.length, 'http called')
      t.end()
    })
})

test('uses lambdaContext from constructor', t => {
  var client = cerberus({ aws: aws, lambdaContext, hostUrl: cerberusHost })

  t.plan(1)

  mockHttp(() => client.get('test'))
    .then(result => {
      t.ok(mockCalls.length, 'http called')
      t.end()
    })
})

test('uses lambdaContext from setLambdaContext', t => {
  var client = cerberus({ aws: aws, hostUrl: cerberusHost })
  client.setLambdaContext(lambdaContext)

  t.plan(1)

  mockHttp(() => client.get('test'))
    .then(result => {
      t.ok(mockCalls.length, 'http called')
      t.end()
    })
    .catch(err => {
      t.comment(err)
      t.fail('error from cerberus')
    })
})

test('Prompt flow prompts if config option is set and other methods fail', t => {
  process.env.CERBERUS_TOKEN = undefined
  t.plan(3) // the 3rd assertion is present to ensure the http server closes before the test completes

  var client = cerberus({ aws: {
    Lambda: function () {
      return {
        getFunctionConfiguration: (data, cb) => {
          t.ok(true, 'lambda called')
          cb({})
        }
      }
    }
  }, hostUrl: cerberusHost, lambdaContext, prompt: true })

  linereads.push('user')
  linereads.push('password')

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

  mockHttp(action, handler)
    .then(result => {
      t.pass('letting the promise finish so the server can close properly')
      t.end()
    },
    reason => {
      t.fail(reason)
      t.end(reason)
    })
})

test('If request returns an errors array treat it like an error in the post-getToken flow', t => {
  process.env.CERBERUS_TOKEN = defaultToken
  let client = cerberus({ hostUrl: cerberusHost, aws: {} })

  const action = () => client.put('some/test/path', 'System expects a JSON object, not a string, this should fail')
  const handler = (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ errors: [ 'Failed to parse JSON input: json: cannot unmarshal string into Go value of type map[string]interface {}' ] }))
  }

  mockHttp(action, handler)
    .then(result => {
      t.fail('The call should not succeed')
      process.env.CERBERUS_TOKEN = undefined
      t.end()
    }, reason => {
      process.env.CERBERUS_TOKEN = undefined
      t.ok(reason === 'Failed to parse JSON input: json: cannot unmarshal string into Go value of type map[string]interface {}')
      t.end()
    })
})

test('If cerberus returns error response return error', t => {
  var client = cerberus({ aws: aws, lambdaContext, hostUrl: cerberusHost })

  t.plan(1)

  mockHttp(() => client.get('test'), { error_id: 'f887ba2a-d104-4323-93e0-d22304932f56', errors: [ { code: 99216, message: 'The specified IAM role is not valid.' } ] })
    .then(result => {
      console.log('test result', result)
      t.fail()
      t.end()
    })
    .catch(error => {
      // t.comment(error)
      t.ok(/IAM role is not valid/.test(error && error.message), 'error from auth result')
      t.end()
    })
})

test('If cerberus returns 404 response return error', t => {
  var client = cerberus({ aws: aws, lambdaContext, hostUrl: cerberusHost })

  t.plan(1)

  var handler = (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    mockCalls.push({req: trimRequest(req), result})
    var result
    if (req.url === '/v1/auth/iam-role') {
      result = defaultCerberusResponse
    } else {
      result = { errors: [] }
      res.statusCode = 404
    }
    res.end(JSON.stringify(result))
  }

  mockHttp(() => client.get('test'), handler)
    .then(result => {
      console.log('test result', result)
      t.fail()
      t.end()
    })
    .catch(error => {
      t.ok(/Status: 404/.test(error && error.message), 'error from auth result')
      t.end()
    })
})

test('If cerberus returns empty response return error', t => {
  var client = cerberus({ aws: aws, lambdaContext, hostUrl: cerberusHost })

  t.plan(1)

  mockHttp(() => client.get('test'), {})
    .then(result => {
      console.log('test result', result)
      t.fail()
      t.end()
    })
    .catch(error => {
      // t.comment(error)
      t.ok(/cannot decrypt token/.test(error && error.message), 'error from auth result')
      t.end()
    })
})

test('If cerberus returns empty response return error using callbacks', t => {
  var client = cerberus({ aws: aws, lambdaContext, hostUrl: cerberusHost })

  t.plan(1)
  mockCalls.length = 0
  var server = http.createServer((req, res) => {
    var result = {}
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
      t.end()
    })
  })
})
