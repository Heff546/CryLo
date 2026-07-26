'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

function readSchema(filename) {
  const schemaPath = path.resolve(
    __dirname,
    '..',
    '..',
    'protocol',
    'schemas',
    filename
  );

  return JSON.parse(
    fs.readFileSync(schemaPath, 'utf8')
  );
}

function createValidator(filename) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  addFormats(ajv);

  return ajv.compile(
    readSchema(filename)
  );
}

const validateConfig =
  createValidator('operator-config.schema.json');

const validateStatus =
  createValidator('operator-status.schema.json');

function formatValidationErrors(errors) {
  return (errors || [])
    .map(error => {
      const location =
        error.instancePath || '/';

      return `${location}: ${error.message}`;
    })
    .join('; ');
}

module.exports = {
  validateConfig,
  validateStatus,
  formatValidationErrors
};
