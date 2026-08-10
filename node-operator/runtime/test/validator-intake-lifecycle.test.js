'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createValidatorIntakeLifecycle
} = require(
  '../src/evidence/validator-intake-lifecycle'
);

function makeRuntime(
  counters,
  options = {}
) {
  let running = false;

  return {
    async start() {
      counters.starts += 1;

      if (options.startError) {
        throw options.startError;
      }

      running = true;

      return {
        host:
          '127.0.0.1',
        port:
          12345,
        route:
          '/v1/validator/reports'
      };
    },

    async stop() {
      counters.stops += 1;

      if (options.stopError) {
        throw options.stopError;
      }

      running = false;
    },

    status() {
      return {
        started:
          running,
        host:
          '127.0.0.1',
        port:
          running
            ? 12345
            : null,
        route:
          '/v1/validator/reports'
      };
    }
  };
}

test(
  'enables Validator intake once',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters
          );
        }
      });

    const result =
      await lifecycle.enable();

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      result.running,
      true
    );

    assert.equal(
      counters.creates,
      1
    );

    assert.equal(
      counters.starts,
      1
    );

    assert.equal(
      lifecycle.status().running,
      true
    );
  }
);

test(
  'duplicate enable does not create another runtime',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters
          );
        }
      });

    await lifecycle.enable();

    const second =
      await lifecycle.enable();

    assert.equal(
      second.changed,
      false
    );

    assert.equal(
      second.running,
      true
    );

    assert.equal(
      counters.creates,
      1
    );

    assert.equal(
      counters.starts,
      1
    );
  }
);

test(
  'disables an active runtime',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters
          );
        }
      });

    await lifecycle.enable();

    const result =
      await lifecycle.disable();

    assert.equal(
      result.changed,
      true
    );

    assert.equal(
      result.running,
      false
    );

    assert.equal(
      counters.stops,
      1
    );

    assert.equal(
      lifecycle.status().running,
      false
    );
  }
);

test(
  'duplicate disable is safe',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters
          );
        }
      });

    await lifecycle.disable();

    await lifecycle.enable();

    await lifecycle.disable();

    const second =
      await lifecycle.disable();

    assert.equal(
      second.changed,
      false
    );

    assert.equal(
      second.running,
      false
    );

    assert.equal(
      counters.stops,
      1
    );
  }
);

test(
  'can enable again after disable',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters
          );
        }
      });

    await lifecycle.enable();
    await lifecycle.disable();
    await lifecycle.enable();

    assert.equal(
      counters.creates,
      2
    );

    assert.equal(
      counters.starts,
      2
    );

    assert.equal(
      counters.stops,
      1
    );

    assert.equal(
      lifecycle.status().running,
      true
    );
  }
);

test(
  'failed startup does not leave runtime active',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          return makeRuntime(
            counters,
            {
              startError:
                new Error(
                  'bind failed'
                )
            }
          );
        }
      });

    await assert.rejects(
      lifecycle.enable(),
      /bind failed/
    );

    assert.equal(
      lifecycle.status().running,
      false
    );

    assert.equal(
      counters.creates,
      1
    );

    assert.equal(
      counters.starts,
      1
    );

    /*
     * Failed startup triggers cleanup of the
     * candidate runtime.
     */
    assert.equal(
      counters.stops,
      1
    );
  }
);

test(
  'concurrent enable calls share one startup',
  async () => {
    const counters = {
      creates: 0,
      starts: 0,
      stops: 0
    };

    let releaseStart;

    const startGate =
      new Promise(
        resolve => {
          releaseStart = resolve;
        }
      );

    const lifecycle =
      createValidatorIntakeLifecycle({
        async createRuntime() {
          counters.creates += 1;

          let running = false;

          return {
            async start() {
              counters.starts += 1;

              await startGate;

              running = true;

              return {
                host:
                  '127.0.0.1',
                port:
                  12345,
                route:
                  '/v1/validator/reports'
              };
            },

            async stop() {
              counters.stops += 1;
              running = false;
            },

            status() {
              return {
                started:
                  running
              };
            }
          };
        }
      });

    const first =
      lifecycle.enable();

    const second =
      lifecycle.enable();

    releaseStart();

    const [
      firstResult,
      secondResult
    ] =
      await Promise.all([
        first,
        second
      ]);

    assert.equal(
      counters.creates,
      1
    );

    assert.equal(
      counters.starts,
      1
    );

    assert.equal(
      firstResult.running,
      true
    );

    assert.equal(
      secondResult.running,
      true
    );

    assert.equal(
      lifecycle.status().running,
      true
    );
  }
);

test(
  'rejects malformed lifecycle options',
  async () => {
    assert.throws(
      () =>
        createValidatorIntakeLifecycle(
          null
        ),
      /must be a plain object/
    );

    assert.throws(
      () =>
        createValidatorIntakeLifecycle({
          createRuntime:
            'not-a-function'
        }),
      /must be a function/
    );
  }
);
