'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

const cryloJs = fs.readFileSync(
  path.join(root, 'scripts', 'crylo.js'),
  'utf8'
);

const launcher = fs.readFileSync(
  path.join(root, 'crylo'),
  'utf8'
);

const releaseJs = fs.readFileSync(
  path.join(root, 'scripts', 'release', 'crylo-release.js'),
  'utf8'
);

function contains(text, fragment, label) {
  assert(
    text.includes(fragment),
    `Missing universal-install invariant: ${label}`
  );
}

contains(
  cryloJs,
  "if (process.platform === 'darwin')",
  'macOS signed release target'
);

contains(
  cryloJs,
  "`CryLo-Release-${version}-mac-`",
  'macOS signed bundle naming'
);

contains(
  cryloJs,
  'function installAuthorizedMacBundle(',
  'macOS signed bundle installer'
);

contains(
  cryloJs,
  'installAuthorizedMacBundle(',
  'macOS installer dispatch'
);

contains(
  cryloJs,
  "'git',\n    'tar'",
  'Linux runtime Git dependency'
);

contains(
  cryloJs,
  "const xcodeSelect = '/usr/bin/xcode-select';",
  'macOS Git dependency preparation'
);

contains(
  cryloJs,
  'update();\n}',
  'install delegates to authenticated update engine'
);

contains(
  launcher,
  'Darwin)',
  'macOS launcher platform detection'
);

contains(
  launcher,
  'node-v$NODE_VERSION-$NODE_PLATFORM-$NODE_ARCH',
  'platform-specific isolated Node runtime'
);

contains(
  launcher,
  'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  'macOS arm64 Node 24.21.0 SHA-256'
);

contains(
  launcher,
  '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
  'macOS x64 Node 24.21.0 SHA-256'
);

contains(
  releaseJs,
  'function createMacReleaseBundle(',
  'macOS official bundle creation'
);

contains(
  releaseJs,
  "`CryLo-Release-${packageJson.version}-mac-${target.arch}.tar`",
  'macOS release bundle filename'
);

contains(
  releaseJs,
  "target.platform === 'mac'",
  'macOS release bundle dispatch'
);

assert(
  !/function install\(\)[\s\S]*?spawnSync\(\s*process\.execPath,\s*\[releaseScript\]/.test(
    cryloJs
  ),
  'Normal crylo install must not build the release from source.'
);

console.log('Universal CryLo install static checks passed.');
