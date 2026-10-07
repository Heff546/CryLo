'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const {
  Wallet
} = require('ethers');

const {
  defaultOperatorDirectory
} = require('../src/config');

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

function trustedWindowsPowerShellPath() {
  const windowsRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    'C:\\Windows';

  return path.join(
    windowsRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
}

function runWindowsAclScript(
  targetPath,
  directory,
  script
) {
  const encodedScript =
    Buffer.from(
      script,
      'utf16le'
    ).toString('base64');

  const result = spawnSync(
    trustedWindowsPowerShellPath(),
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodedScript
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        CRYLO_ACL_TARGET:
          targetPath,
        CRYLO_ACL_DIRECTORY:
          directory ? '1' : '0'
      }
    }
  );

  assert.equal(
    result.error,
    undefined,
    result.error && result.error.message
  );

  assert.equal(
    result.status,
    0,
    String(
      result.stderr ||
      result.stdout ||
      'Windows ACL command failed.'
    ).trim()
  );
}

function secureWindowsPrivatePath(
  targetPath,
  directory
) {
  if (process.platform !== 'win32') {
    return;
  }

  runWindowsAclScript(
    targetPath,
    directory,
    String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:CRYLO_ACL_TARGET
$isDirectory = $env:CRYLO_ACL_DIRECTORY -eq '1'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$administratorsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl

if ($isDirectory) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
}

$acl.SetOwner($userSid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($userSid, $systemSid, $administratorsSid)) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $fullControl, $inheritance, $propagation, $allow)
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
`
  );
}

function addWindowsBroadReadAccess(
  targetPath,
  directory
) {
  void directory;

  const windowsRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    'C:\\Windows';

  const icaclsPath =
    path.join(
      windowsRoot,
      'System32',
      'icacls.exe'
    );

  const result = spawnSync(
    icaclsPath,
    [
      targetPath,
      '/grant',
      '*S-1-1-0:R'
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    }
  );

  assert.equal(
    result.error,
    undefined,
    result.error && result.error.message
  );

  assert.equal(
    result.status,
    0,
    String(
      result.stderr ||
      result.stdout ||
      'icacls failed to add the test ACE.'
    ).trim()
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

  if (process.platform === 'win32') {
    secureWindowsPrivatePath(
      directory,
      true
    );
  }

  await fs.writeFile(
    keyPath,
    `${privateKey}\n`,
    {
      encoding: 'utf8',
      mode
    }
  );

  if (process.platform === 'win32') {
    secureWindowsPrivatePath(
      keyPath,
      false
    );
  } else {
    await fs.chmod(
      keyPath,
      mode
    );
  }

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
  {
    skip:
      process.platform === 'win32'
  },
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
  {
    skip:
      process.platform === 'win32'
  },
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
  {
    skip:
      process.platform === 'win32'
  },
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
  'rejects a Windows signing key with broad file ACL access',
  {
    skip:
      process.platform !== 'win32'
  },
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

    addWindowsBroadReadAccess(
      keyPath,
      false
    );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /Windows ACL is unsafe/
    );
  }
);

test(
  'rejects a Windows signing key inside a broadly accessible directory',
  {
    skip:
      process.platform !== 'win32'
  },
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

    addWindowsBroadReadAccess(
      directory,
      true
    );

    await assert.rejects(
      loadSigningKey({
        keyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /Windows ACL is unsafe/
    );
  }
);
test(
  'rejects a signing key reached through a directory symlink or junction',
  async t => {
    const directory =
      await createTemporaryDirectory();

    const realDirectory =
      path.join(
        directory,
        'real'
      );

    const redirectDirectory =
      path.join(
        directory,
        'redirect'
      );

    await fs.mkdir(realDirectory);

    const wallet =
      Wallet.createRandom();

    const realKeyPath =
      await writeKeyFile(
        realDirectory,
        wallet.privateKey
      );

    await fs.symlink(
      realDirectory,
      redirectDirectory,
      process.platform === 'win32'
        ? 'junction'
        : 'dir'
    );

    if (process.platform === 'win32') {
      secureWindowsPrivatePath(
        redirectDirectory,
        true
      );
    }

    t.after(async () => {
      await fs.rm(
        redirectDirectory,
        {
          recursive: true,
          force: true
        }
      );

      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    });

    const redirectedKeyPath =
      path.join(
        redirectDirectory,
        path.basename(realKeyPath)
      );

    await assert.rejects(
      loadSigningKey({
        keyPath: redirectedKeyPath,
        expectedOperatorAddress:
          wallet.address
      }),
      /symbolic link|reparse redirect/
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

    if (process.platform === 'win32') {
      secureWindowsPrivatePath(
        directory,
        true
      );

      secureWindowsPrivatePath(
        keyPath,
        false
      );
    }

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
        defaultOperatorDirectory(),
        'signing-key'
      )
    );
  }
);
