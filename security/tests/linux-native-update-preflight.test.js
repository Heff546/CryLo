'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyStagedLinuxNativeExecutables } =
  require('../../scripts/release/linux-native-update-preflight');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-linux-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = {
    directory: path.join(root, 'installed'),
    daemon: 'CryLo-daemon',
    walletCli: 'CryLo-wallet',
    walletRpc: 'CryLo-wallet-rpc'
  };
  fs.mkdirSync(native.directory, { recursive: true });

  const staged = [native.daemon, native.walletCli, native.walletRpc].map((name) => {
    const destination = path.join(native.directory, name);
    const temporary = path.join(root, name + '.new');
    fs.writeFileSync(destination, 'original installed binary');
    fs.writeFileSync(
      temporary,
      '#!/bin/sh\nprintf "%s\\n" "CryLo Chain \'Testnet\' (v1.1.1)"\n',
      { mode: 0o755 }
    );
    fs.chmodSync(temporary, 0o755);
    return { destination, temporary };
  });

  return { native, staged };
}

function assertOriginalsUnchanged({ native }) {
  for (const name of [native.daemon, native.walletCli, native.walletRpc]) {
    assert.equal(
      fs.readFileSync(path.join(native.directory, name), 'utf8'),
      'original installed binary'
    );
  }
}

test('accepts three executable CryLo Testnet candidates without replacing files', (t) => {
  const state = fixture(t);
  assert.doesNotThrow(() =>
    verifyStagedLinuxNativeExecutables(state.staged, state.native, 'testnet')
  );
  assertOriginalsUnchanged(state);
});

test('rejects GLIBC loader error before any installed file is replaced', (t) => {
  const state = fixture(t);
  fs.writeFileSync(
    state.staged[1].temporary,
    '#!/bin/sh\necho "GLIBC_2.38 not found" >&2\nexit 127\n',
    { mode: 0o755 }
  );
  assert.throws(
    () => verifyStagedLinuxNativeExecutables(state.staged, state.native, 'testnet'),
    /GLIBC_2\\.38 not found/
  );
  assertOriginalsUnchanged(state);
});

test('rejects a non-executable signed candidate', (t) => {
  const state = fixture(t);
  fs.chmodSync(state.staged[0].temporary, 0o644);
  assert.throws(
    () => verifyStagedLinuxNativeExecutables(state.staged, state.native, 'testnet'),
    /cannot run on this system/
  );
  assertOriginalsUnchanged(state);
});

test('rejects candidates for the wrong network', (t) => {
  const state = fixture(t);
  assert.throws(
    () => verifyStagedLinuxNativeExecutables(state.staged, state.native, 'mainnet'),
    /identifies as Testnet/
  );
  assertOriginalsUnchanged(state);
});

test('rejects missing native candidates', (t) => {
  const state = fixture(t);
  state.staged.pop();
  assert.throws(
    () => verifyStagedLinuxNativeExecutables(state.staged, state.native, 'testnet'),
    /missing CryLo-wallet-rpc/
  );
  assertOriginalsUnchanged(state);
});
