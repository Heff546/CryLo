'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ABI_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'abis'
);

const CONTRACT_ABI_FILES = Object.freeze({
  NodeStaking: 'CryLoNodeStaking.json',
  RewardManager: 'RewardManager.json',
  RewardVault: 'RewardVault.json',
  Staking: 'CryLoStaking.json'
});

function resolveAbiDirectory(overrideDirectory) {
  return overrideDirectory
    ? path.resolve(overrideDirectory)
    : DEFAULT_ABI_DIRECTORY;
}

function loadAbiFile(filename, options = {}) {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new TypeError('ABI filename must be a non-empty string');
  }

  const abiDirectory = resolveAbiDirectory(options.abiDirectory);
  const abiPath = path.resolve(abiDirectory, filename);

  if (!abiPath.startsWith(`${abiDirectory}${path.sep}`)) {
    throw new Error(`ABI path escapes configured directory: ${filename}`);
  }

  if (!fs.existsSync(abiPath)) {
    throw new Error(`ABI file not found: ${abiPath}`);
  }

  let artifact;

  try {
    artifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to parse ABI file ${abiPath}: ${error.message}`
    );
  }

  const abi = Array.isArray(artifact)
    ? artifact
    : artifact?.abi;

  if (!Array.isArray(abi)) {
    throw new Error(`ABI file does not contain an ABI array: ${abiPath}`);
  }

  return {
    abi,
    artifact,
    path: abiPath
  };
}

function loadContractAbi(contractName, options = {}) {
  const filename = CONTRACT_ABI_FILES[contractName];

  if (!filename) {
    throw new Error(`Unsupported contract ABI: ${contractName}`);
  }

  return loadAbiFile(filename, options);
}

module.exports = {
  CONTRACT_ABI_FILES,
  DEFAULT_ABI_DIRECTORY,
  loadAbiFile,
  loadContractAbi,
  resolveAbiDirectory
};
