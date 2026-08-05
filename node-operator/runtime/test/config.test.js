'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  validateServicePaths
} = require('../src/config');

const ROOT =
  '/home/test/.config/crylo-wallet/operator';

function validConfig() {
  return {
    service: {
      serviceName:
        'crylo-nexus-operator.service',
      statusPath:
        path.join(ROOT, 'status.json'),
      dataDirectory:
        path.join(ROOT, 'data'),
      logDirectory:
        path.join(ROOT, 'logs')
    }
  };
}

test(
  'accepts the exact user-scoped operator layout',
  () => {
    const result =
      validateServicePaths(
        validConfig(),
        ROOT
      );

    assert.equal(
      result.statusPath,
      path.join(ROOT, 'status.json')
    );

    assert.equal(
      result.dataDirectory,
      path.join(ROOT, 'data')
    );

    assert.equal(
      result.logDirectory,
      path.join(ROOT, 'logs')
    );
  }
);

test(
  'rejects relative service paths',
  () => {
    const config = validConfig();

    config.service.statusPath =
      'status.json';

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /absolute path/
    );
  }
);

test(
  'rejects non-normalized traversal paths',
  () => {
    const config = validConfig();

    config.service.statusPath =
      `${ROOT}/data/../status.json`;

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /normalized/
    );
  }
);

test(
  'rejects paths outside the operator directory',
  () => {
    const config = validConfig();

    config.service.dataDirectory =
      '/tmp/crylonexus-operator';

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /must equal/
    );
  }
);

test(
  'rejects sibling-prefix path attacks',
  () => {
    const config = validConfig();

    config.service.logDirectory =
      `${ROOT}-attacker/logs`;

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /must equal/
    );
  }
);

test(
  'rejects an incorrect status filename',
  () => {
    const config = validConfig();

    config.service.statusPath =
      path.join(ROOT, 'operator-status.json');

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /must equal/
    );
  }
);

test(
  'rejects reused service paths',
  () => {
    const config = validConfig();

    config.service.logDirectory =
      config.service.dataDirectory;

    assert.throws(
      () =>
        validateServicePaths(
          config,
          ROOT
        ),
      /must equal|distinct/
    );
  }
);

test(
  'rejects malformed top-level input',
  () => {
    for (const value of [
      null,
      [],
      'config'
    ]) {
      assert.throws(
        () =>
          validateServicePaths(
            value,
            ROOT
          ),
        /object/
      );
    }
  }
);
