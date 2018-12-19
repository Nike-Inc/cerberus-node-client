#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="${SCRIPT_DIR}/.."
DOCSTRAP_PATH="${ROOT_DIR}/node_modules/ink-docstrap/template/"

# Clear out old docs
rm -fr ${ROOT_DIR}/build/docs

# create the directory structure
mkdir -p ${ROOT_DIR}/build/docs

jsdoc --recurse --configure ./.jsdoc.json \
--tutorials ${ROOT_DIR}/tutorials \
--template ${DOCSTRAP_PATH} \
--readme ${ROOT_DIR}/README.md \
--destination build/docs/ \
index.js ${ROOT_DIR}/lib
