'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function readText(...parts) {
  return fs.readFileSync(
    path.join(root, ...parts),
    'utf8'
  ).replace(/\r\n/g, '\n');
}

const cryloJs = readText('scripts', 'crylo.js');

assert(
  cryloJs.includes(
    "const requiredPackages = [\n    'ca-certificates',\n    'curl',\n    'git',\n    'tar'\n  ];"
  ),
  'Linux crylo install must prepare Git as a runtime dependency.'
);

assert(
  cryloJs.includes(
    "const target = releaseTarget();"
  ),
  'crylo install must select the signed platform target.'
);

assert(
  cryloJs.includes(
    "if (process.platform === 'linux') {\n    ensureLinuxRuntimeDependencies();\n  }"
  ),
  'Linux crylo install must prepare runtime dependencies before update.'
);

assert(
  cryloJs.includes(
    "Installing the current authenticated prebuilt CryLo"
  ),
  'crylo install must use the authenticated prebuilt release path.'
);

const installStart = cryloJs.indexOf('function install() {');
const startStart = cryloJs.indexOf('\nfunction start() {', installStart);

assert(installStart >= 0 && startStart > installStart);

const installBody = cryloJs.slice(
  installStart,
  startStart
);

assert(
  installBody.includes('update();'),
  'crylo install must delegate to the authenticated update engine.'
);

assert(
  !installBody.includes('ensureLinuxBuildDependencies();'),
  'Normal crylo install must not prepare source-build dependencies.'
);

assert(
  !installBody.includes('[releaseScript]'),
  'Normal crylo install must not invoke the source release builder.'
);

console.log(
  'Windows/Linux/Pi crylo install static checks passed.'
);
