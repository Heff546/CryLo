
const fs = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  Wallet,
  getAddress
} = require('ethers');

const {
  assertPrivateKey
} = require('./detached-signing');

const {
  defaultOperatorDirectory
} = require('../config');

const FORBIDDEN_PERMISSION_MASK = 0o077;

function defaultSigningKeyPath() {
  return path.join(
    defaultOperatorDirectory(),
    'signing-key'
  );
}

function requireNonEmptyString(
  value,
  name
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

function normalizeExpectedAddress(value) {
  requireNonEmptyString(
    value,
    'Expected operator address'
  );

  try {
    return getAddress(value);
  } catch (error) {
    throw new TypeError(
      'Expected operator address must be a valid Ethereum address',
      {
        cause: error
      }
    );
  }
}

function normalizePathForComparison(value) {
  const normalized =
    path.normalize(
      path.resolve(value)
    );

  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

async function assertNoSigningKeyPathRedirection(
  keyPath,
  stat
) {
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Operator signing key path must not be a symbolic link or reparse redirect: ${keyPath}`
    );
  }

  const realPath =
    await fs.realpath(keyPath);

  if (
    normalizePathForComparison(realPath) !==
    normalizePathForComparison(keyPath)
  ) {
    throw new Error(
      `Operator signing key path must not traverse a symbolic link or reparse redirect: ${keyPath}`
    );
  }
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

function assertSecureWindowsPrivateAcl(
  targetPath
) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:CRYLO_ACL_TARGET

if ([string]::IsNullOrWhiteSpace($target)) {
  throw 'CryLo ACL target is missing.'
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$allowed = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
$acl = Get-Acl -LiteralPath $target

if (-not $acl.AreAccessRulesProtected) {
  throw 'ACL inheritance is enabled.'
}

try {
  $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
} catch {
  $ownerSid = (New-Object System.Security.Principal.SecurityIdentifier($acl.Owner)).Value
}

if ($ownerSid -ne $userSid) {
  throw 'ACL owner does not match the runtime user.'
}

$allow = [System.Security.AccessControl.AccessControlType]::Allow
$required = [int64][System.Security.AccessControl.FileSystemRights]::FullControl
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
$seen = @{}

foreach ($rule in $rules) {
  $sid = $rule.IdentityReference.Value
  if ($allowed -notcontains $sid) { throw ('Unexpected ACL principal: ' + $sid) }
  if ($rule.IsInherited) { throw ('Inherited ACL entry detected: ' + $sid) }
  if ($rule.AccessControlType -ne $allow) { throw ('Non-Allow ACL entry detected: ' + $sid) }
  $granted = [int64]$rule.FileSystemRights
  if (($granted -band $required) -ne $required) { throw ('Incomplete ACL rights for: ' + $sid) }
  $seen[$sid] = $true
}

foreach ($sid in $allowed) {
  if (-not $seen.ContainsKey($sid)) { throw ('Required ACL principal is missing: ' + $sid) }
}
`;

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
          targetPath
      }
    }
  );

  if (result.error) {
    throw new Error(
      `Operator signing-key Windows ACL could not be verified: ${targetPath}`,
      { cause: result.error }
    );
  }

  if (result.status !== 0) {
    const detail =
      String(
        result.stderr ||
        result.stdout ||
        'ACL verification failed.'
      ).trim();

    throw new Error(
      `Operator signing-key Windows ACL is unsafe: ${targetPath}: ${detail}`
    );
  }
}
function assertSecureKeyFile(
  stat,
  keyPath
) {
  if (!stat.isFile()) {
    throw new Error(
      `Operator signing key path is not a regular file: ${keyPath}`
    );
  }

  if (process.platform === 'win32') {
    assertSecureWindowsPrivateAcl(
      path.dirname(keyPath)
    );

    assertSecureWindowsPrivateAcl(
      keyPath
    );
  } else {
    const permissions =
      stat.mode & 0o777;

    if (
      permissions &
      FORBIDDEN_PERMISSION_MASK
    ) {
      throw new Error(
        `Operator signing key file permissions are unsafe: ` +
        `${permissions.toString(8).padStart(3, '0')}; expected 600 or stricter`
      );
    }
  }

  if (
    typeof process.getuid === 'function' &&
    stat.uid !== process.getuid()
  ) {
    throw new Error(
      'Operator signing key file must be owned by the runtime user'
    );
  }
}

async function loadSigningKey(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.getPrototypeOf(options) !==
      Object.prototype
  ) {
    throw new TypeError(
      'Signing key loader options must be a plain object'
    );
  }

  const expectedSignerAddress =
    normalizeExpectedAddress(
      options.expectedSignerAddress === undefined
        ? options.expectedOperatorAddress
        : options.expectedSignerAddress
    );

  const configuredPath =
    options.keyPath === undefined
      ? (
          process.env
            .CRYLONEXUS_OPERATOR_SIGNING_KEY_FILE ||
          defaultSigningKeyPath()
        )
      : requireNonEmptyString(
          options.keyPath,
          'Operator signing key path'
        );

  const keyPath =
    path.resolve(configuredPath);

  let stat;

  try {
    stat = await fs.lstat(keyPath);
  } catch (error) {
    if (
      error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(
        `Operator signing key file does not exist: ${keyPath}`,
        {
          cause: error
        }
      );
    }

    throw error;
  }

  await assertNoSigningKeyPathRedirection(
    keyPath,
    stat
  );

  assertSecureKeyFile(
    stat,
    keyPath
  );

  const serialized =
    await fs.readFile(
      keyPath,
      'utf8'
    );

  const privateKey =
    serialized.trim();

  if (
    serialized
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .length !== 1
  ) {
    throw new Error(
      'Operator signing key file contains unexpected surrounding content'
    );
  }

  assertPrivateKey(
    privateKey
  );

  const wallet =
    new Wallet(privateKey);

  if (
    wallet.address !==
    expectedSignerAddress
  ) {
    throw new Error(
      `Operator signing key address mismatch: expected ` +
      `${expectedSignerAddress}, derived ${wallet.address}`
    );
  }

  return Object.freeze({
    keyPath,
    privateKey
  });
}

module.exports = Object.freeze({
  FORBIDDEN_PERMISSION_MASK,
  defaultSigningKeyPath,
  loadSigningKey
});
