'use strict';

function parseValidatorConsensusMinimumReports(
  value
) {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    throw new Error(
      'CRYLONEXUS_VALIDATOR_MINIMUM_REPORTS must be a positive integer'
    );
  }

  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      'CRYLONEXUS_VALIDATOR_MINIMUM_REPORTS must be a positive safe integer'
    );
  }

  return parsed;
}

module.exports = Object.freeze({
  parseValidatorConsensusMinimumReports
});
