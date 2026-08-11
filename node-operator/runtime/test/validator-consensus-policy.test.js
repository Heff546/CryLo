'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseValidatorConsensusMinimumReports
} = require(
  '../src/evidence/validator-consensus-policy'
);

test(
  'accepts a positive integer consensus threshold',
  () => {
    assert.equal(
      parseValidatorConsensusMinimumReports(
        '3'
      ),
      3
    );

    assert.equal(
      parseValidatorConsensusMinimumReports(
        '12'
      ),
      12
    );
  }
);

test(
  'rejects missing consensus threshold',
  () => {
    assert.throws(
      () =>
        parseValidatorConsensusMinimumReports(
          undefined
        ),
      /positive integer/
    );
  }
);

test(
  'rejects zero and negative consensus thresholds',
  () => {
    for (const value of [
      '0',
      '-1'
    ]) {
      assert.throws(
        () =>
          parseValidatorConsensusMinimumReports(
            value
          ),
        /positive integer/
      );
    }
  }
);

test(
  'rejects fractional and malformed thresholds',
  () => {
    for (const value of [
      '1.5',
      'abc',
      '',
      ' 3 ',
      '+3'
    ]) {
      assert.throws(
        () =>
          parseValidatorConsensusMinimumReports(
            value
          ),
        /positive integer/
      );
    }
  }
);
