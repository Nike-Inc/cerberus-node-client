'use strict'
const aws4 = require('aws4')
const request = require('request-micro')

module.exports = {
  assumeRole: assumeRole
}

function assumeRole (options) {
  return request(aws4.sign({
    service: 'sts',
    protocol: 'https:',
    path: `/?Version=2011-06-15&Action=AssumeRole&RoleSessionName=CerberusAssumeRole&RoleArn=${options.assumeRoleArn}`,
    headers: {
      'Accept': 'application/json'
    }
  })).then(response => {
    if (!response.statusCode || response.statusCode.toString()[0] !== '2') {
      throw new Error('Error assuming role. ' + JSON.stringify(response.data.toString()))
    }
    return JSON.parse(response.data.toString())
  })
}

