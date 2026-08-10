'use strict';

function requirePlainObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw new TypeError(
      `${name} must be a plain object`
    );
  }

  return value;
}

function requireFunction(
  value,
  name
) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${name} must be a function`
    );
  }

  return value;
}

function createValidatorIntakeLifecycle(
  options
) {
  requirePlainObject(
    options,
    'Validator intake lifecycle options'
  );

  const createRuntime =
    requireFunction(
      options.createRuntime,
      'Validator intake runtime factory'
    );

  let runtime = null;
  let starting = null;

  async function enable() {
    if (runtime) {
      return Object.freeze({
        changed: false,
        running: true,
        transport:
          runtime.status()
      });
    }

    if (starting) {
      return await starting;
    }

    starting =
      (async () => {
        const candidate =
          await createRuntime();

        requirePlainObject(
          candidate,
          'Validator intake runtime'
        );

        requireFunction(
          candidate.start,
          'Validator intake runtime start'
        );

        requireFunction(
          candidate.stop,
          'Validator intake runtime stop'
        );

        requireFunction(
          candidate.status,
          'Validator intake runtime status'
        );

        try {
          const transport =
            await candidate.start();

          runtime = candidate;

          return Object.freeze({
            changed: true,
            running: true,
            transport
          });
        } catch (error) {
          try {
            await candidate.stop();
          } catch {
            // Preserve the original start failure.
          }

          throw error;
        }
      })();

    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  async function disable() {
    if (starting) {
      try {
        await starting;
      } catch {
        // Failed startup leaves no active runtime.
      }
    }

    if (!runtime) {
      return Object.freeze({
        changed: false,
        running: false
      });
    }

    const active =
      runtime;

    await active.stop();

    runtime = null;

    return Object.freeze({
      changed: true,
      running: false
    });
  }

  function status() {
    if (!runtime) {
      return Object.freeze({
        running: false,
        transport: null
      });
    }

    return Object.freeze({
      running: true,
      transport:
        runtime.status()
    });
  }

  return Object.freeze({
    enable,
    disable,
    status
  });
}

module.exports = Object.freeze({
  createValidatorIntakeLifecycle
});
