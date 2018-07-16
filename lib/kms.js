'use strict'
const co = require('co')
const aws4 = require('aws4')
const request = require('request-micro')

module.exports = {
  decrypt: decrypt
}

function decrypt (text, options) {
  return co(function * () {
    let kmsResponse
    kmsResponse = yield request(aws4.sign({
      service: 'kms',
      region: options.region,
      method: 'POST',
      protocol: 'https:',
      path: '/',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': 'TrentService.Decrypt'
      },
      body: JSON.stringify({ CiphertextBlob: text })
    }, options.credentials))
    let result = JSON.parse(kmsResponse.data.toString())
    if (result.err && result.err.message && result.err.message.indexOf('The ciphertext references a key that either does not exist or you do not have access to') !== -1) {
      throw new Error('You do not have access to the KMS key required for authentication. The most likely cause is that your IAM role does not have the KMS Decrypt action. You will need to add it to your role.')
    }
    try {
      return JSON.parse(Buffer.from(result.Plaintext, 'base64').toString())
    } catch (e) {
      throw new Error('Error parsing KMS decrypt Result. ' + e.message)
    }
  })
}

