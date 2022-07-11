const { defaultProvider: fetchAwsCredentials } = require('@aws-sdk/credential-provider-node')
const { getDefaultRoleAssumerWithWebIdentity } = require('@aws-sdk/client-sts')
const { fromTokenFile } = require('@aws-sdk/credential-provider-web-identity')
const crypto = require('crypto')

const CHINA_REGIONS = ['cn-north-1', 'cn-northwest-1']

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

const getAuthenticationHeaders = async (region) => {
  let awsCredentials
  let credsErrors = []

  // Fetch credentials from the AWS Default credentials provider chain
  try {
    awsCredentials = await fetchAwsCredentials()()
  } catch (error) {
    credsErrors.push(error)
  }

  try {
    // IMPORTANT: When running with EKS roles, it is required to explicitly specify a value for roleAssumerWithWebIdentity.
    // There is a default function available in @aws-sdk/client-sts package. Source: https://github.com/aws/aws-sdk-js-v3/tree/main/packages/credential-provider-node
    if (!awsCredentials) {
      awsCredentials = await fromTokenFile({
        roleAssumerWithWebIdentity: getDefaultRoleAssumerWithWebIdentity()
      })()
    }
  } catch (error) {
    credsErrors.push(error)
  }

  if (!awsCredentials) {
    // Not successful in getting credentials.
    throw new Error(
      'Failed to get AWS credentials, do you have IAM credentials available?\n' +
        "See: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html\nmsg: '" +
        credsErrors.map(err => err.message).join('\n') +
        "'"
    )
  }
  const { accessKeyId, secretAccessKey, sessionToken } = awsCredentials

  const signedHeaders = 'host;x-amz-date'
  const date = new Date()
  const dateISO = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateScope = dateISO.slice(0, 8)
  const dateUTC = date.toUTCString()
  let url = `host:sts.${region}.amazonaws.com`

  if (CHINA_REGIONS.includes(region)) {
    url = url.concat('.cn')
  }

  const canonicalRequest = [
    'POST',
    '/',
    '',
    url,
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
