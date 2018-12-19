// const CerberusClient = require('../index')
//
// const getRequiredEnvironmentVariable = (envVar) => {
//   const val = process.env[envVar]
//   if (!val) {
//     throw new Error(`required envVar: '${envVar}' was not set`)
//   }
//   return val
// }
//
// const cerberusHost = getRequiredEnvironmentVariable('CERBERUS_HOST')
// const cerberusBasePath = getRequiredEnvironmentVariable('CERBERUS_SDB')
//
// let client = new CerberusClient({
//   hostUrl: cerberusHost
// })
//
// const testId = require('uuid/v1')
//
//
