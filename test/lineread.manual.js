var cerberus = require('../index')

var appPath = 'app/devportal-dev/config'
var client = cerberus({ hostUrl: 'https://prod.cerberus.nikecloud.com', prompt: true, debug: true })

client.list(appPath)
  .then(result => console.log(result))
  .catch(err => console.log('error getting token', err))
