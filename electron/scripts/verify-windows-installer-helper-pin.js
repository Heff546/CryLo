'use strict';

/**
 * Fail closed before packaging Windows NSIS if the embedded authenticated
 * runtime helper does not match the exact SHA-256 that NSIS checks at install.
 *
 * This is a packaging-time integrity gate, not a replacement for runtime
 * certutil/findstr verification. Other platform packaging is unaffected.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function verifyWindowsInstallerHelperPin(electronDir, options = {}) {
  const helper = options.helperPath ||
    path.join(electronDir, 'build', 'windows-installer-runtime.js');
  const nsis = options.nsisPath ||
    path.join(electronDir, 'build', 'installer.nsh');
  const helperFile = fs.lstatSync(helper);
  const nsisFile = fs.lstatSync(nsis);
  if (!helperFile.isFile() || helperFile.isSymbolicLink() ||
      !nsisFile.isFile() || nsisFile.isSymbolicLink()) {
    throw new Error('Windows NSIS helper and trust configuration must be regular files');
  }

  const installer = fs.readFileSync(nsis, 'utf8');
  const checks = [...installer.matchAll(
    /findstr\.exe[^\r\n]*?([0-9a-f]{64})[^\r\n]*?crylo-hash-output\.txt/gi
  )];
  if (checks.length !== 3) {
    throw new Error('Expected three explicit Windows NSIS trust hashes (helper, Node archive and Node EXE)');
  }

  const expected = checks[0][1].toLowerCase();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
  if (actual !== expected) {
    throw new Error('Windows NSIS helper SHA256 mismatch; packaging refused. Expected: ' +
      expected + ' Actual: ' + actual);
  }

  console.log('PASS: Windows NSIS authenticated installer helper pin ' + actual);
  return actual;
}

module.exports = Object.freeze({ verifyWindowsInstallerHelperPin });

if (require.main === module) {
  try {
    verifyWindowsInstallerHelperPin(path.resolve(__dirname, '..'));
  } catch (error) {
    console.error('ERROR: ' + error.message);
    process.exitCode = 1;
  }
}
