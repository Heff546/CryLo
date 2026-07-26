'use strict';

function valueType(value) {
  return value === null
    ? 'null'
    : typeof value;
}

function childPath(parent, key) {
  return Number.isInteger(key)
    ? `${parent}[${key}]`
    : `${parent}.${key}`;
}

function assertPlainObject(value, location) {
  const prototype = Object.getPrototypeOf(value);

  if (
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError(
      `Canonical JSON only accepts plain objects at ${location}`
    );
  }
}

function serializeNumber(value, location) {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `Canonical JSON rejects non-finite numbers at ${location}`
    );
  }

  if (Object.is(value, -0)) {
    return '0';
  }

  return JSON.stringify(value);
}

function serializeValue(value, location, ancestors) {
  const type = valueType(value);

  switch (type) {
    case 'null':
      return 'null';

    case 'boolean':
      return value ? 'true' : 'false';

    case 'string':
      return JSON.stringify(value);

    case 'number':
      return serializeNumber(value, location);

    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError(
        `Canonical JSON rejects ${type} at ${location}`
      );

    case 'object':
      break;

    default:
      throw new TypeError(
        `Canonical JSON rejects unsupported type ${type} at ${location}`
      );
  }

  if (ancestors.has(value)) {
    throw new TypeError(
      `Canonical JSON rejects circular structures at ${location}`
    );
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const entries = [];

      for (
        let index = 0;
        index < value.length;
        index += 1
      ) {
        if (
          !Object.prototype.hasOwnProperty.call(
            value,
            index
          )
        ) {
          throw new TypeError(
            `Canonical JSON rejects sparse arrays at ${childPath(location, index)}`
          );
        }

        entries.push(
          serializeValue(
            value[index],
            childPath(location, index),
            ancestors
          )
        );
      }

      return `[${entries.join(',')}]`;
    }

    assertPlainObject(value, location);

    const entries = [];

    for (const key of Object.keys(value).sort()) {
      entries.push(
        `${JSON.stringify(key)}:${serializeValue(
          value[key],
          childPath(location, key),
          ancestors
        )}`
      );
    }

    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value) {
  return serializeValue(
    value,
    '$',
    new Set()
  );
}

function canonicalJsonBytes(value) {
  return Buffer.from(
    canonicalJson(value),
    'utf8'
  );
}

module.exports = {
  canonicalJson,
  canonicalJsonBytes
};
