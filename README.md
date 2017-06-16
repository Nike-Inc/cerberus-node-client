# Cerberus Node Client

This is a node client for interacting with a Cerberus backend. It can be used in Amazon EC2 instances and Amazon Lambdas.

To learn more about Cerberus, please visit the [Cerberus website](http://engineering.nike.com/cerberus/).

# Installation

```
npm install --save cerberus-node-client
```

Then, require the package with `var cerberus = require('cerberus-node-client')`

## QuickStart

```
var cerberus = require('cerberus-node-client')
var client = cerberus({ hostUrl: YOUR_CERBERUS_HOST })
client.get('app/YOURAPP/your/keypath').then(secrets => {
  console.log(secrets) // { key1: value1, key2: value2 }
})
```

## Authentication

The cerberus client supports four different configuration modes.

* Lambda Context - Pass in the `context` from your Lambda Handler `handler(event, context)` as the `lambdaContext` parameter.
* EC2 - This is the default mode, it will be used if the other two are not present.
* Environment Variables - This is useful for running locally without changing out code, since developer machines cannot posses the IAM roles necessary to decrypt Cerberus authentication responses.
  * `CERBERUS_TOKEN` - This environment variable will skip token retrival and just use the provided token to talk to cerberus
* CLI Prompt - This method will run if `prompt: true` is passed to the client constructor, after all other methods fail, and will prompt on the command line for developer credentials. This should only be used in testing.

These configuration modes determine how the client will authenticate with Cerberus.

Cerberus will attempt to authenticate one its first call. The authentication result will be stored and reused. If the token has expired on a subsequent call, authentication will be repeated with the original configuration. You should not have to worry about authentication or token expiration; just use the client.

# Constructing the client

```javascript
var cerberus = require('cerberus-node-client')

var client = cerberus({
    // string, The cerberus URL to use.
    // OVERRIDDEN by process.env.CERBERUS_ADDR
    // Either this or the env variable is required
    hostUrl: YOUR_CERBERUS_HOST,


    // The context given to the lambda handler
    lambdaContext: context,

    // boolean, defaults to false. When true will console.log many operations
    debug: true,

    // This will be used as the cerberus X-Vault-Token if supplied
    // OVERRIDDEN by process.env.CERBERUS_TOKEN
    // If present, normal authentication with cerberus will be skipped
    // You should normally only be using this in testing environments
    // When developing locally, it is easier to use process.env.CERBERUS_TOKEN
    token: 'Some_Auth_Token'
  })
```

# Using the Client

This client should be compatible with node 0.12.x (this has not yet been tested, please submit bug reports if you run into issues). It supports both node-style `cb(err [, data])` callbacks and promises.

To use the promise API omit the callback parameter (always the last one), and ensure `global.Promise` supports constructing promises with `new Promise()`. Promises will be returned from all client methods in this case; otherwise, `undefined` will be returned.

**KeyPaths** below are relative to the Cerberus root. This is shown as the `path` value when looking at a Safety Deposit Box (SDB). You must include the full path (including `app` or `shared`) not just the name of the SDB.

> Note to new users: The key path is the path ***exactly*** as shown in the UI, it is ***not*** `${keyPath}/${keyName}`. All of the keys/value paris will be returned from a `get` request as a normal JavaScript object. For example, in the image below `get('app/devportal-prod/config/keys')` would return `{ githubJenkins: 'someSecret' }`. A request for `get('app/devportal-prod/config/keys/githubJenkins')` will return a 404, since that is not a valid path.

![The key path](http://i.imgur.com/WeiWbxE.png)

* `get(keyPath [, callback])` - Read the contents of the **keyPath**. Returns an object
* `set(keyPath, data [, callback])` - Set the contents of the **keyPath**. Returns `data`
* `put` - alias for `set`
* `list(keypath [, callback])` - List the paths available at the **keyPath**. Returns an array
* `delete(keyPath [, callback])` - Delete the contents of the **keyPath**. Returns an object
*  `remove` - alias for `delete`
* `setLambdaContext(context` - Set the `lambdaContext` after construction. See *Providing the client to your app* for details


# Providing the client to your app

Using Cerberus in your app will be easier if you create a wrapper module that handles construction and exports the constructed client. A standard wrappper would look like this

```javascript
var cerberus = require('cerberus-node-client')
var client = cerberus({ hostUrl: process.env.CERBERUS_HOST })

module.exports = client
```

If you are using a Lambda, the `lambdaContext` cannot be set at startup, it can only be set from inside the lambda `handler`. Luckily, you can set the context on an already constructed client.

```javascript
var cerberus = require('./util/cerberus') // or wherever you put your wrapper

exports.handler = handler

function handler (event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false
  cerberus.setLambdaContext(context)
}
```

As long as the rest of your app `require`s your wrapper module, the context will be set and everyone should work.

# Maintenance

This project is maintained by Tim Kye `timothy.kye@nike.com`

## License

Cerberus Management Service is released under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)

[travis]:https://travis-ci.org/Nike-Inc/cerberus-management-service
[travis img]:https://api.travis-ci.org/Nike-Inc/cerberus-management-service.svg?branch=master

[license]:LICENSE.txt
[license img]:https://img.shields.io/badge/License-Apache%202-blue.svg
