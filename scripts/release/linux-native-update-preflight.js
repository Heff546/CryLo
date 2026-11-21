'use strict';

// A signed release can still contain a Linux executable that the user's
// distribution cannot load (for example a newer GLIBC requirement).
// Run all three authenticated, hash-verified native candidates from their
// staged paths BEFORE replacing any installed files.
const path = require('path');
const { spawnSync } = require('child_process');

function verifyStagedLinuxNativeExecutables(staged, native, networkMode) {
  if (!Array.isArray(staged) || !native || !native.directory ||
      !['testnet', 'mainnet'].includes(networkMode)) {
    throw new Error('Invalid CryLo Linux native update preflight inputs.');
  }

  for (const name of [native.daemon, native.walletCli, native.walletRpc]) {
    if (typeof name !== 'string' || !name) {
      throw new Error('Missing required CryLo Linux native executable name.');
    }

    const destination = path.join(native.directory, name);
    const candidate = staged.find((item) =>
      item.destination === destination &&
      typeof item.temporary === 'string' &&
      item.temporary.length > 0
    );

    if (!candidate) {
      throw new Error(`Linux native update preflight is missing ${name}.`);
    }

    const result = spawnSync(candidate.temporary, ['--version'], {
      encoding: 'utf8',
      shell: false,
      timeout: 15000,
      maxBuffer: 256 * 1024
    });
    const output = [
      String(result.stdout || ''),
      String(result.stderr || '')
    ].join('\n').trim();

    if (result.error || result.signal || result.status !== 0) {
      const detail = [
        result.error && result.error.message,
        output,
        result.signal && `signal ${result.signal}`,
        result.status !== null && `exit ${result.status}`
      ].filter(Boolean).join('; ').slice(0, 1200);
      throw new Error(
        `CryLo Linux update blocked: staged ${name} cannot run on this ` +
        `system (${detail || 'unknown loader error'}). ` +
        'Existing CryLo binaries have not been replaced.'
      );
    }

    if (networkMode === 'testnet' &&
        !output.includes("CryLo Chain 'Testnet'")) {
      throw new Error(
        `CryLo Linux update blocked: staged ${name} does not identify as ` +
        'CryLo Testnet. Existing CryLo binaries have not been replaced.'
      );
    }

    if (networkMode === 'mainnet' && /testnet/i.test(output)) {
      throw new Error(
        `CryLo Linux update blocked: staged ${name} identifies as Testnet. ` +
        'Existing CryLo binaries have not been replaced.'
      );
    }

    console.log(`Native runtime preflight..... PASS  ${name}`);
  }
}

module.exports = { verifyStagedLinuxNativeExecutables };
