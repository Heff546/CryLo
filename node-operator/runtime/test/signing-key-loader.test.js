'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  Wallet
} = require('ethers');

const {
  defaultSigningKeyPath,
  loadSigningKey
} = require(
  '../src/evidence/signing-key-loader'
);

async function createTemporaryDirectory() {
  return fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'crylonexus-signing-key-'
    )
  );
}

async function writeKeyFile(
  directory,
  privateKey,
  mode = 0o600
) {
  const keyPath =
    path.join(
      directory,
      'signing-key'
    );

  await fs.writeFile(
    keyPath,
    `${privateKey}\n`,
    {
      encoding: 'utf8',
      mode
    }
  );

  await fs.chmod(
    keyPath,
    mode
  );

  return keyPath;
}

test(
  'loads a securely stored signing key',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        wallet.privateKey
      );

    const result =
      await loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      });

    assert.equal(
      result.keyPath,
      keyPath
    );

    assert.equal(
      result.privateKey,
      wallet.privateKey
    );

    assert.equal(
      Object.isFrozen(result),
      true
    );
  }
);

test(
  'accepts owner-read-only permissions',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        wallet.privateKey,
        0o400
      );

    const result =
      await loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      });

    assert.equal(
      result.privateKey,
      wallet.privateKey
    );
  }
);

test(
  'rejects group-readable permissions',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        wallet.privateKey,
        0o640
      );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /permissions are unsafe/
    );
  }
);

test(
  'rejects world-readable permissions',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        wallet.privateKey,
        0o604
      );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /permissions are unsafe/
    );
  }
);

test(
  'rejects a key for another operator',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const signer =
      Wallet.createRandom();

    const otherOperator =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        signer.privateKey
      );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          otherOperator.address
      }),
      /address mismatch/
    );
  }
);

test(
  'rejects malformed private keys',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      await writeKeyFile(
        directory,
        'not-a-private-key'
      );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /private key/i
    );
  }
);

test(
  'rejects extra file content',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    const keyPath =
      path.join(
        directory,
        'signing-key'
      );

    await fs.writeFile(
      keyPath,
      `${wallet.privateKey}\nextra\n`,
      {
        mode: 0o600
      }
    );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /unexpected surrounding content|private key/i
    );
  }
);

test(
  'rejects missing key files',
  async () => {
    const wallet =
      Wallet.createRandom();

    await assert.rejects(
      loadSigningKey({
        keyPath:
          '/tmp/does-not-exist-crylonexus-key',
        expectedOperatorAddress:
          wallet.address
      }),
      /does not exist/
    );
  }
);

test(
  'rejects directories',
  async t => {
    const directory =
      await createTemporaryDirectory();

    t.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const wallet =
      Wallet.createRandom();

    await assert.rejects(
      loadSigningKey({
        keyPath: directory,
        expectedOperatorAddress:
          wallet.address
      }),
      /not a regular file/
    );
  }
);

test(
  'rejects malformed loader options',
  async () => {
    for (const value of [
      null,
      undefined,
      [],
      true,
      'options'
    ]) {
      await assert.rejects(
        loadSigningKey(value),
        /plain object/
      );
    }
  }
);

test(
  'rejects invalid expected addresses',
  async () => {
    await assert.rejects(
      loadSigningKey({
        keyPath:
          '/tmp/key',
        expectedOperatorAddress:
          'not-an-address'
      }),
      /valid Ethereum address/
    );
  }
);

test(
  'provides the protected default path',
  () => {
    assert.equal(
      defaultSigningKeyPath(),
      path.join(
        os.homedir(),
        '.config',
        'crylo-wallet',
        'operator',
        'signing-key'
      )
    );
  }
);
