/* eslint-env jest */
const CerberusClient = require('../index')

const getRequiredEnvironmentVariable = (envVar) => {
  const val = process.env[envVar]
  if (!val) {
    throw new Error(`required envVar: '${envVar}' was not set`)
  }
  return val
}

const cerberusHost = getRequiredEnvironmentVariable('CERBERUS_HOST')

let client = new CerberusClient({
  hostUrl: cerberusHost
})

test('test that a token can be fetched with sts', async () => {
  const token = await client._getToken()
  expect(token).toBeTruthy()
})
