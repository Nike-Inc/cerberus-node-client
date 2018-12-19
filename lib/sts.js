const AWS = require('aws-sdk')
const crypto = require('crypto')

function hmac (key, string, encoding) {
  return crypto
    .createHmac('sha256', key)
    .update(string, 'utf8')
    .digest(encoding)
}

function hash (string, encoding) {
  return crypto
    .createHash('sha256')
    .update(string, 'utf8')
    .digest(encoding)
}

const getAWSCredentials = () => {
  const credChain = new AWS.CredentialProviderChain()
  return new Promise((resolve, reject) => {
    credChain.resolve((err, credentials) => {
      if (err) reject(err)
      resolve(credentials)
    })
  })
}

const getAuthenticationHeaders = async (region) => {
  // Fetch credentials from the AWS Default credentials provider chain
  let awsCredentials
  try {
    awsCredentials = await getAWSCredentials()
  } catch (e) {
    throw new Error('Failed to get AWS credentials, do you have IAM credentials available?\n' +
      'See: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html\nmsg: \'' + e.message + '\'')
  }
  let { accessKeyId, secretAccessKey, sessionToken } = awsCredentials

  const signedHeaders = 'host;x-amz-date'
  const date = new Date()
  const dateISO = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateScope = dateISO.slice(0, 8)
  const dateUTC = date.toUTCString()

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `host:sts.${region}.amazonaws.com`,
    `x-amz-date:${dateISO}`,
    '',
    signedHeaders,
    hash('Action=GetCallerIdentity&Version=2011-06-15', 'hex')
  ].join('\n')

  const canonicalRequestHash = hash(canonicalRequest, 'hex')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateISO,
    `${dateScope}/${region}/sts/aws4_request`,
    canonicalRequestHash
  ].join('\n')

  const kDate = hmac(`AWS4${secretAccessKey}`, dateScope)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 'sts')
  const kCredentials = hmac(kService, 'aws4_request')

  const signature = hmac(kCredentials, stringToSign, 'hex')

  let headers = {
    Accept: 'application/json',
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateScope}/${region}/sts/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    Date: dateUTC,
    'x-amz-date': dateISO
  }

  if (sessionToken) {
    headers = Object.assign({}, headers, {
      'x-amz-security-token': sessionToken
    })
  }

  return headers
}

module.exports = {
  getAuthenticationHeaders: getAuthenticationHeaders
}
