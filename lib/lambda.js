'use strict'
const aws4 = require('aws4')
const request = require('request-micro')

module.exports = {
  getFunctionConfiguration: getFunctionConfiguration
}

function getFunctionConfiguration (options) {
  return request(aws4.sign({
    service: 'lambda',
    region: options.region,
    method: 'POST',
    path: `/2015-03-31/functions/${options.FunctionName}/configuration${options.Qualifier ? '?Qualifier=' + options.Qualifier : ''}`,
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'GetFunctionConfiguration'
    }
  }))
}
