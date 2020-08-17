/* eslint-disable no-trailing-spaces */
/* eslint-env jest */
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const CerberusClient = require('../index')

const getRequiredEnvironmentVariable = (envVar) => {
  const val = process.env[envVar]
  if (!val) {
    throw new Error(`required envVar: '${envVar}' was not set`)
  }
  return val
}

const cerberusHost = getRequiredEnvironmentVariable('CERBERUS_HOST')
const testRegion = getRequiredEnvironmentVariable('TEST_REGION')
const testSDB = getRequiredEnvironmentVariable('TEST_SDB')
const testSDBCategory = getRequiredEnvironmentVariable('TEST_SDB_CATEGORY')
const testId = uuidv4()

const cerberusClient = new CerberusClient({
  hostUrl: cerberusHost,
  region: testRegion
})

describe('The CerberusClient', () => {
  test('can authenticate with sts', async () => {
    const token = await cerberusClient._getToken()
    expect(token).toBeTruthy()
  })

  describe('can be used to interact with /v1/secret and', () => {
    const testSecretPayload = {
      foo: 'bar',
      bam: 'boop'
    }
    it('write a secret', async () => {
      await cerberusClient.writeSecureData(`${testSDBCategory}/${testSDB}/${testId}/secret-payload`, testSecretPayload)
    })

    it('list the secrets that where just written', async () => {
      const listRes = await cerberusClient.listPathsForSecureData(`${testSDBCategory}/${testSDB}/${testId}/`)
      expect(listRes.keys).toEqual(['secret-payload'])
    })

    it('read the secret that was writen', async () => {
      const payload = await cerberusClient.getSecureData(`${testSDBCategory}/${testSDB}/${testId}/secret-payload`)
      expect(payload).toEqual(testSecretPayload)
    })

    it('delete the secret', async () => {
      await cerberusClient.deleteSecureData(`${testSDBCategory}/${testSDB}/${testId}/secret-payload`)
      const listRes2 = await cerberusClient.listPathsForSecureData(`${testSDBCategory}/${testSDB}/${testId}/`)
      expect(listRes2.keys).toEqual([])
    })
  })

  describe('can be used to interact with /v1/secret-files and', () => {
    const file = fs.readFileSync(`${process.env.PROJECT_DIR}/LICENSE.txt`)

    it('write a file', async () => {
      await cerberusClient.writeFile(`${testSDBCategory}/${testSDB}/${testId}/secret-file`, file)
    })

    it('list the file', async () => {
      const listRes = await cerberusClient.listFile(`${testSDBCategory}/${testSDB}/${testId}/`)
      expect(listRes.secure_file_summaries.length).toEqual(1)
      expect(listRes.secure_file_summaries[0].path).toEqual(`${testSDB}/${testId}/secret-file`)
    })

    it('read the file', async () => {
      const fileRes = await cerberusClient.readFile(`${testSDBCategory}/${testSDB}/${testId}/secret-file`)
      const buffer = Buffer.from(fileRes)
      expect(buffer).toEqual(file)
    })

    it('delete the file', async () => {
      await cerberusClient.deleteFile(`${testSDBCategory}/${testSDB}/${testId}/secret-file`)
      const listRes = await cerberusClient.listFile(`${testSDBCategory}/${testSDB}/${testId}/`)
      expect(listRes.secure_file_summaries.length).toEqual(0)
    })
  })
})
