#!/usr/bin/env bash


echo "Preparing .npmrc"
echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc
echo 'registry=http://registry.npmjs.org' >> .npmrc

npm publish --otp=$(oathtool -b --totp ${NPM_OTP})
