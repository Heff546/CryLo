'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith('--')) {
    fail(`${name} requires a value.`);
  }

  return value;
}

const keyArgument = argument('--key');
const network = argument('--network') || 'testnet';

if (!['testnet', 'mainnet'].includes(network)) {
  fail(`Unsupported signing network: ${network}`);
}

if (!keyArgument) {
  fail(
    '--key must point to an Ed25519 private signing key.\n' +
    'The private key must never be committed to the repository.'
  );
}

const manifestPath = path.join(
  root,
  'electron',
  'dist',
  'crylo-release-manifest.json'
);

if (!fs.existsSync(manifestPath)) {
  fail(`Release manifest was not found: ${manifestPath}`);
}

const keyPath = path.resolve(keyArgument);

if (!fs.existsSync(keyPath)) {
  fail(`Signing key was not found: ${keyPath}`);
}

const manifest = fs.readFileSync(manifestPath);

let manifestData;

try {
  manifestData = JSON.parse(
    manifest.toString('utf8')
  );
} catch (error) {
  fail(`Release manifest JSON is invalid: ${error.message}`);
}

if (manifestData.network !== network) {
  fail(
    `Manifest network is ${manifestData.network || 'missing'}; ` +
    `signing network is ${network}.`
  );
}

if (manifestData.signatureAlgorithm !== 'Ed25519') {
  fail(
    `Manifest signature algorithm is ` +
    `${manifestData.signatureAlgorithm || 'missing'}, not Ed25519.`
  );
}

const privateKey = crypto.createPrivateKey(
  fs.readFileSync(keyPath)
);

if (privateKey.asymmetricKeyType !== 'ed25519') {
  fail(
    `Signing key is ${privateKey.asymmetricKeyType || 'unknown'}, ` +
    'not Ed25519.'
  );
}

const trustedPublicKeyPath = path.join(
  root,
  'scripts',
  'release',
  'keys',
  `crylo-${network}-release-ed25519-public.pem`
);

if (!fs.existsSync(trustedPublicKeyPath)) {
  fail(
    `Trusted ${network} release public key was not found: ` +
    `${trustedPublicKeyPath}`
  );
}

const trustedPublicKey = crypto.createPublicKey(
  fs.readFileSync(trustedPublicKeyPath)
);

if (trustedPublicKey.asymmetricKeyType !== 'ed25519') {
  fail(
    `Trusted ${network} public key is not Ed25519.`
  );
}

const derivedPublicKey = crypto.createPublicKey(privateKey);

const trustedDer = trustedPublicKey.export({
  type: 'spki',
  format: 'der'
});

const derivedDer = derivedPublicKey.export({
  type: 'spki',
  format: 'der'
});

if (!crypto.timingSafeEqual(trustedDer, derivedDer)) {
  fail(
    `Signing private key does not match the trusted ${network} ` +
    'release public key.'
  );
}

const signature = crypto.sign(
  null,
  manifest,
  privateKey
);

const signaturePath =
  `${manifestPath}.sig`;

fs.writeFileSync(
  signaturePath,
  signature.toString('base64') + '\n',
  'utf8'
);

console.log('CryLo release manifest signed.');
console.log(`Network:   ${network}`);
console.log('Signing key match..... VERIFIED');
console.log(`Manifest:  ${manifestPath}`);
console.log(`Signature: ${signaturePath}`);
