'use strict'

var test = require('blue-tape')
var proxyquire = require('proxyquire')

var mock = function () {}
proxyquire('../index', {
  'request-micro': function () {
    mock.apply(null, arguments)
  }
})
var cerberus = require('../index.js')

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
  var client = cerberus({ hostUrl: 'test', aws: {} })

  mock = (options, cb) => {
    process.env.CERBERUS_TOKEN = original
    t.equal(options.headers['X-Vault-Token'], testToken, 'Vault header uses CERBERUS_TOKEN')
    t.end()
  }
  client.get('test')
})

test('uses environment variable for hostUrl when present', t => {
  var original = process.env.CERBERUS_ADDR
  var testUrl = 'test url'
  process.env.CERBERUS_ADDR = testUrl
  var client = cerberus({ aws: {} })

  mock = (options, cb) => {
    process.env.CERBERUS_ADDR = original
    t.equal(options.url, 'test url/v1/secret/test', 'url uses CERBERUS_ADDR')
    t.end()
  }
  client.get('test')
})

test('get calls request', t => {
  var client = cerberus({ hostUrl: 'test', aws: {}, token: '1' })
  mock = (options, cb) => {
    t.ok(true)
    t.end()
  }
  client.get('test')
})
