# Cerberus Node Client

This is a node client for interacting with a Cerberus backend. It can be used in any environment that has [AWS credentials][node aws credentials] available.

To learn more about Cerberus, please visit the [Cerberus website](http://engineering.nike.com/cerberus/).

This library is compatible with node 8.x +, for previous versions of Node use the [1.x versions of the client](https://github.com/Nike-Inc/cerberus-node-client/tree/1.X_kms_client)

[![Build Status][travis img]][travis] [![Coverage Status][coverage img]][coverage] [![NPM][npm img]][npm] [![License][license img]][license]

## Installation

```
npm install --save cerberus-node-client
```

## Usage

See the [CerberusClient](http://engineering.nike.com/cerberus-node-client/CerberusClient.html) class on the [the docs site][docs]

## Authentication

The cerberus client uses the [AWS SDK Credentials provider chain][node aws credentials] to load AWS IAM credentials and authenticates with Cerberus via the [sts auth endpoint](https://github.com/Nike-Inc/cerberus-management-service/blob/master/API.md#app-login-sts-v2-v2authsts-identity)
This client will work in any environment that has access to AWS Credentials.

Cerberus will attempt to authenticate one its first call. The authentication result will be stored and reused. If the token has expired on a subsequent call, authentication will be repeated with the original configuration. You should not have to worry about authentication or token expiration; just use the client.

## Testing
First, make sure the following environment variables are set before running the Node Client integration tests:
```
export CERBERUS_HOST="https://example.cerberus.com"
export TEST_SDB="my-sdb"
export TEST_SDB_CATEGORY="app"
```
Ensure the TEST_SDB and TEST_SDB_CATEGORY variables match up with the path to your test sdb (i.e. app/my-sdb/test-path)

Then make sure AWS credentials have been obtained. One method is by running [gimme-aws-creds](https://github.com/Nike-Inc/gimme-aws-creds):
```
gimme-aws-creds
```

Next, in the project directory run: 
```
npm run style && npm run test:unit:local && npm run test:integration
```

## A Note about Lambdas and Cerberus

While this client supports any env with IAM credentials, generally it does NOT make sense to store Lambda secrets in Cerberus for two reasons:

1. Cerberus can't support the scale that lambdas may need, e.g. thousands of requests per second
1. Lambdas will not want the extra latency needed to authenticate and read from Cerberus

A better solution for Lambda secrets is using the [encrypted environmental variables](http://docs.aws.amazon.com/lambda/latest/dg/env_variables.html)
feature provided by AWS.

Another option is to store Lambda secrets in Cerberus but only read them at Lambda deploy time, then storing them as encrypted
environmental variables, to avoid the extra Cerberus runtime latency.

## License

Cerberus Management Service is released under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)

[travis]:https://travis-ci.org/Nike-Inc/cerberus-node-client
[travis img]:https://api.travis-ci.org/Nike-Inc/cerberus-node-client.svg?branch=master

[license]:https://github.com/Nike-Inc/cerberus-node-client/blob/master/LICENSE.txt
[license img]:https://img.shields.io/badge/License-Apache%202-blue.svg

[npm]:https://www.npmjs.com/package/cerberus-node-client
[npm img]:https://img.shields.io/npm/v/cerberus-node-client.svg

[coverage]:https://coveralls.io/github/Nike-Inc/cerberus-node-client?branch=master
[coverage img]:https://coveralls.io/repos/github/Nike-Inc/cerberus-node-client/badge.svg?branch=master

[docs]:http://engineering.nike.com/cerberus-node-client/
[node aws credentials]:https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
