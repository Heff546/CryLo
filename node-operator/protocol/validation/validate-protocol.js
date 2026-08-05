'use strict';

const fs = require('fs');
const path = require('path');

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const SCHEMAS = {
  releaseManifest: path.join(
    ROOT,
    'schemas',
    'release-manifest.schema.json'
  ),
  operatorConfig: path.join(
    ROOT,
    'schemas',
    'operator-config.schema.json'
  ),
  operatorStatus: path.join(
    ROOT,
    'schemas',
    'operator-status.schema.json'
  ),
  heartbeatEnvelope: path.join(
    ROOT,
    'schemas',
    'heartbeat-envelope.schema.json'
  ),
  verifierObservation: path.join(
    ROOT,
    'schemas',
    'verifier-observation.schema.json'
  ),
  verificationWindow: path.join(
    ROOT,
    'schemas',
    'verification-window.schema.json'
  )
};

const VALID_FIXTURES = [
  {
    schema: 'releaseManifest',
    file: 'examples/release-manifest.valid.json'
  },
  {
    schema: 'operatorConfig',
    file: 'examples/operator-config.valid.json'
  },
  {
    schema: 'operatorStatus',
    file: 'examples/operator-status.valid.json'
  },
  {
    schema: 'heartbeatEnvelope',
    file: 'examples/heartbeat-envelope.valid.json'
  },
  {
    schema: 'verifierObservation',
    file: 'examples/verifier-observation.valid.json'
  },
  {
    schema: 'verificationWindow',
    file: 'examples/verification-window.valid.json'
  }
];

const INVALID_FIXTURES = [
  {
    schema: 'operatorConfig',
    file: 'tests/invalid/operator-config.wrong-chain.json'
  },
  {
    schema: 'operatorConfig',
    file: 'tests/invalid/operator-config.secret-field.json'
  },
  {
    schema: 'releaseManifest',
    file: 'tests/invalid/release-manifest.bad-channel.json'
  },
  {
    schema: 'operatorStatus',
    file: 'tests/invalid/operator-status.future.json'
  },
  {
    schema: 'heartbeatEnvelope',
    file: 'tests/invalid/heartbeat-envelope.bad-chain.json'
  },
  {
    schema: 'verifierObservation',
    file: 'tests/invalid/verifier-observation.pass-with-failure-code.json'
  }
];

const FORBIDDEN_KEYS = new Set([
  'privatekey',
  'mnemonic',
  'seed',
  'seedphrase',
  'walletpassword',
  'walletfile',
  'deployerkey',
  'ownerkey',
  'treasurykey',
  'bridgereservekey',
  'releasesigningprivatekey'
]);

const TIMESTAMP_KEYS = new Set([
  'releasedAt',
  'generatedAt',
  'startedAt',
  'updatedAt',
  'lastHeartbeatAt',
  'verifiedAt',
  'lastRunAt',
  'firstSeenAt',
  'issuedAt',
  'expiresAt',
  'observedAt',
  'windowStartedAt',
  'windowEndedAt'
]);

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const stat = fs.statSync(absolutePath);

  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${relativePath} exceeds ${MAX_DOCUMENT_BYTES} bytes`
    );
  }

  return JSON.parse(
    fs.readFileSync(absolutePath, 'utf8')
  );
}

function findForbiddenKey(value, location = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findForbiddenKey(
        value[index],
        `${location}[${index}]`
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = key
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();

    if (FORBIDDEN_KEYS.has(normalized)) {
      return `${location}.${key}`;
    }

    const result = findForbiddenKey(
      child,
      `${location}.${key}`
    );

    if (result) {
      return result;
    }
  }

  return null;
}

function findFutureTimestamp(value, location = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findFutureTimestamp(
        value[index],
        `${location}[${index}]`
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      TIMESTAMP_KEYS.has(key) &&
      typeof child === 'string'
    ) {
      const timestamp = Date.parse(child);

      if (
        Number.isFinite(timestamp) &&
        timestamp > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS
      ) {
        return `${location}.${key}`;
      }
    }

    const result = findFutureTimestamp(
      child,
      `${location}.${key}`
    );

    if (result) {
      return result;
    }
  }

  return null;
}

function validatePolicies(document) {
  const forbiddenLocation = findForbiddenKey(document);

  if (forbiddenLocation) {
    return {
      valid: false,
      errors: [
        `Forbidden secret field at ${forbiddenLocation}`
      ]
    };
  }

  const futureLocation = findFutureTimestamp(document);

  if (futureLocation) {
    return {
      valid: false,
      errors: [
        `Timestamp is unreasonably in the future at ${futureLocation}`
      ]
    };
  }

  return {
    valid: true,
    errors: []
  };
}

function formatAjvErrors(errors) {
  return (errors || []).map((error) => {
    const location = error.instancePath || '$';
    return `${location} ${error.message}`;
  });
}

function main() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true
  });

  addFormats(ajv);

  const validators = {};

  for (const [name, schemaPath] of Object.entries(SCHEMAS)) {
    const schema = JSON.parse(
      fs.readFileSync(schemaPath, 'utf8')
    );

    validators[name] = ajv.compile(schema);
  }

  let failures = 0;

  for (const fixture of VALID_FIXTURES) {
    const document = readJson(fixture.file);
    const validate = validators[fixture.schema];
    const schemaValid = validate(document);
    const policy = validatePolicies(document);

    if (!schemaValid || !policy.valid) {
      failures += 1;
      console.error(`FAIL valid fixture: ${fixture.file}`);

      for (const error of formatAjvErrors(validate.errors)) {
        console.error(`  schema: ${error}`);
      }

      for (const error of policy.errors) {
        console.error(`  policy: ${error}`);
      }

      continue;
    }

    console.log(`PASS valid fixture: ${fixture.file}`);
  }

  for (const fixture of INVALID_FIXTURES) {
    const document = readJson(fixture.file);
    const validate = validators[fixture.schema];
    const schemaValid = validate(document);
    const policy = validatePolicies(document);

    if (schemaValid && policy.valid) {
      failures += 1;
      console.error(
        `FAIL unsafe fixture was accepted: ${fixture.file}`
      );
      continue;
    }

    console.log(
      `PASS unsafe fixture rejected: ${fixture.file}`
    );
  }

  if (failures > 0) {
    console.error(
      `Protocol validation failed with ${failures} error(s).`
    );
    process.exit(1);
  }

  console.log(
    'All valid fixtures were accepted and all unsafe fixtures were rejected.'
  );
}

try {
  main();
} catch (error) {
  console.error('Protocol validation could not complete.');
  console.error(error);
  process.exit(1);
}
