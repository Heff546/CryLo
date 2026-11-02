'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Preserve the packaging gate entry point. Derive the helper pin from
// canonical committed bytes; the two Node trust pins remain explicit.
function verifyWindowsInstallerHelperPin(electronDir) {
  const { stageWindowsInstallerHelper } = require('./before-pack');
  const result = stageWindowsInstallerHelper(electronDir);
  const source = fs.readFileSync(path.join(electronDir, 'build', 'installer.nsh'), 'utf8');
  const hashes = [...source.matchAll(/findstr\.exe[^\r\n]*?([0-9a-f]{64})[^\r\n]*?crylo-hash-output\.txt/gi)].map(m => m[1].toLowerCase());
  const expected = [
    '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
    'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
  ];
  if (JSON.stringify(hashes) !== JSON.stringify(expected)) {
    throw new Error('Windows NSIS Node archive/executable trust pins differ.');
  }
  console.log('PASS: generated NSIS helper pin and pinned Node hashes verified');
  return result.hash;
}

module.exports = Object.freeze({ verifyWindowsInstallerHelperPin });
if (require.main === module) {
  try { verifyWindowsInstallerHelperPin(path.resolve(__dirname, '..')); }
  catch (error) { console.error('ERROR: ' + error.message); process.exitCode = 1; }
}
