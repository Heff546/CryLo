'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WINDOWS_BUILD_RUNTIME_MANIFEST =
  'WINDOWS-BUILD-RUNTIME-MANIFEST.json';

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function detectPeArchitecture(file) {
  const buffer = fs.readFileSync(file);

  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    fail(`Invalid Windows PE file: ${file}`);
  }

  const peOffset = buffer.readUInt32LE(0x3c);

  if (
    peOffset + 6 > buffer.length ||
    buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000'
  ) {
    fail(`Invalid Windows PE signature: ${file}`);
  }

  const machine = buffer.readUInt16LE(peOffset + 4);

  if (machine === 0x8664) {
    return 'x64';
  }

  if (machine === 0xaa64) {
    return 'arm64';
  }

  fail(`Unsupported Windows PE machine type 0x${machine.toString(16)}: ${file}`);
}

function findWindowsBash() {
  const candidates = [
    process.env.CRYLO_MSYS2_BASH,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\tools\\msys64\\usr\\bin\\bash.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  fail(
    'MSYS2 bash was not found. Set CRYLO_MSYS2_BASH to the trusted MSYS2 bash.exe.'
  );
}

function windowsRuntimeDirectory() {
  const bash = findWindowsBash();
  const msysRoot = path.resolve(path.dirname(bash), '..', '..');
  const expected = path.join(msysRoot, 'mingw64', 'bin');

  if (process.env.CRYLO_WINDOWS_RUNTIME_DLL_DIR) {
    const configured = path.resolve(process.env.CRYLO_WINDOWS_RUNTIME_DLL_DIR);

    if (
      configured.localeCompare(
        expected,
        undefined,
        { sensitivity: 'accent' }
      ) !== 0
    ) {
      fail(
        'CRYLO_WINDOWS_RUNTIME_DLL_DIR must refer to the mingw64/bin directory ' +
        'belonging to the same MSYS2 installation as CRYLO_MSYS2_BASH.'
      );
    }

    return configured;
  }

  return expected;
}

function runCapture(command, args, label) {
  const result = spawnSync(
    command,
    args,
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    }
  );

  if (result.error || result.status !== 0) {
    const detail = (
      String(result.stdout || '') +
      String(result.stderr || '')
    ).trim();

    fail(
      `${label} failed` +
      (detail ? `:\n${detail}` : '.')
    );
  }

  return String(result.stdout || '').trim();
}

function objdumpDependencies(file, runtimeDirectory) {
  const objdump = path.join(runtimeDirectory, 'objdump.exe');

  if (!fs.existsSync(objdump)) {
    fail(`MSYS2 objdump is missing: ${objdump}`);
  }

  const output = runCapture(
    objdump,
    ['-p', file],
    `objdump dependency inspection for ${file}`
  );

  const dependencies = [];

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/DLL Name:\s*(\S+)/i);

    if (match) {
      dependencies.push(match[1]);
    }
  }

  return [...new Set(dependencies)]
    .sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    );
}

function isApiSet(name) {
  return /^(?:api|ext)-ms-win-/i.test(name);
}

function isWindowsSystemDependency(name) {
  if (isApiSet(name)) {
    return true;
  }

  const systemRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    'C:\\Windows';

  const candidates = [
    path.join(systemRoot, 'System32', name),
    path.join(systemRoot, name)
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
}

function shellSafeRuntimeName(name) {
  if (!/^[A-Za-z0-9_.+\-]+\.dll$/i.test(name)) {
    fail(`Unsafe Windows runtime DLL name: ${name}`);
  }

  return name;
}

function msysPackageForRuntime(name) {
  const safeName = shellSafeRuntimeName(name);
  const bash = findWindowsBash();

  const output = runCapture(
    bash,
    [
      '-lc',
      `pkg=$(pacman -Qqo -- '/mingw64/bin/${safeName}') && pacman -Q -- "$pkg"`
    ],
    `MSYS2 package ownership lookup for ${safeName}`
  );

  const match = output.match(/^(\S+)\s+(.+)$/);

  if (!match) {
    fail(`Unexpected pacman package output for ${safeName}: ${output}`);
  }

  return {
    package: match[1],
    packageVersion: match[2]
  };
}

function verifyInstalledPackage(packageName) {
  if (!/^[A-Za-z0-9@._+\-]+$/.test(packageName)) {
    fail(`Unsafe MSYS2 package name: ${packageName}`);
  }

  const bash = findWindowsBash();

  runCapture(
    bash,
    ['-lc', `pacman -Qkk -- '${packageName}'`],
    `MSYS2 installed-package integrity verification for ${packageName}`
  );
}

function installedPackageSnapshot() {
  const bash = findWindowsBash();

  const output = runCapture(
    bash,
    ['-lc', 'pacman -Q'],
    'MSYS2 installed-package snapshot'
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(.+)$/);

      if (!match) {
        fail(`Unexpected pacman -Q output: ${line}`);
      }

      return {
        name: match[1],
        version: match[2]
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function describePe(file, runtimeDirectory) {
  const stat = fs.statSync(file);

  return {
    file: path.basename(file),
    size: stat.size,
    sha256: sha256(file),
    architecture: detectPeArchitecture(file),
    dependencies: objdumpDependencies(file, runtimeDirectory)
  };
}

function discoverWindowsBuildRuntime({
  rootFiles,
  architecture,
  network
}) {
  if (process.platform !== 'win32') {
    fail('Windows runtime discovery must run on a Windows host.');
  }

  if (!Array.isArray(rootFiles) || rootFiles.length === 0) {
    fail('Windows runtime discovery requires at least one root executable.');
  }

  if (!['x64', 'arm64'].includes(architecture)) {
    fail(`Unsupported Windows architecture: ${architecture}`);
  }

  if (!['testnet', 'mainnet'].includes(network)) {
    fail(`Unsupported CryLo network: ${network}`);
  }

  const runtimeDirectory = windowsRuntimeDirectory();
  const roots = [];
  const runtimeByName = new Map();
  const systemDependencies = new Set();
  const queue = [];

  function classifyDependency(name) {
    const safeName = shellSafeRuntimeName(name);
    const runtimeSource = path.join(runtimeDirectory, safeName);

    if (fs.existsSync(runtimeSource)) {
      const key = safeName.toLowerCase();

      if (!runtimeByName.has(key)) {
        runtimeByName.set(key, null);
        queue.push(runtimeSource);
      }

      return;
    }

    if (isWindowsSystemDependency(safeName)) {
      systemDependencies.add(safeName);
      return;
    }

    fail(
      `Unresolved Windows DLL dependency: ${safeName}. ` +
      'It is neither present in the trusted MSYS2 mingw64/bin directory ' +
      'nor recognized as a Windows system DLL.'
    );
  }

  for (const rootFile of rootFiles) {
    if (!fs.existsSync(rootFile)) {
      fail(`Windows runtime discovery root is missing: ${rootFile}`);
    }

    const root = describePe(rootFile, runtimeDirectory);

    if (root.architecture !== architecture) {
      fail(
        `${root.file} is ${root.architecture}, expected ${architecture}.`
      );
    }

    roots.push(root);

    for (const dependency of root.dependencies) {
      classifyDependency(dependency);
    }
  }

  while (queue.length > 0) {
    const runtimeSource = queue.shift();
    const runtime = describePe(runtimeSource, runtimeDirectory);

    if (runtime.architecture !== architecture) {
      fail(
        `${runtime.file} is ${runtime.architecture}, expected ${architecture}.`
      );
    }

    const owner = msysPackageForRuntime(runtime.file);

    runtime.package = owner.package;
    runtime.packageVersion = owner.packageVersion;

    runtimeByName.set(runtime.file.toLowerCase(), runtime);

    for (const dependency of runtime.dependencies) {
      classifyDependency(dependency);
    }
  }

  const runtime = [...runtimeByName.values()]
    .filter(Boolean)
    .sort((left, right) =>
      left.file.localeCompare(right.file, undefined, { sensitivity: 'base' })
    );

  const runtimePackages = [
    ...new Set(runtime.map((entry) => entry.package))
  ].sort();

  for (const packageName of runtimePackages) {
    verifyInstalledPackage(packageName);
  }

  return {
    schema: 1,
    product: 'CryLo',
    kind: 'windows-build-runtime',
    platform: 'win',
    architecture,
    network,
    generatedUtc: new Date().toISOString(),
    nodeVersion: process.version,
    roots: roots.sort((left, right) => left.file.localeCompare(right.file)),
    runtime,
    systemDependencies: [...systemDependencies].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    ),
    msys2Packages: installedPackageSnapshot()
  };
}

function validateWindowsBuildRuntimeManifest(
  manifest,
  {
    architecture = null,
    network = null
  } = {}
) {
  if (
    !manifest ||
    manifest.schema !== 1 ||
    manifest.product !== 'CryLo' ||
    manifest.kind !== 'windows-build-runtime' ||
    manifest.platform !== 'win' ||
    !['x64', 'arm64'].includes(manifest.architecture) ||
    !['testnet', 'mainnet'].includes(manifest.network) ||
    !/^[a-f0-9]{40,64}$/i.test(manifest.gitCommit || '') ||
    !Array.isArray(manifest.roots) ||
    !Array.isArray(manifest.runtime) ||
    !Array.isArray(manifest.systemDependencies) ||
    !Array.isArray(manifest.msys2Packages)
  ) {
    fail('Windows build/runtime manifest is malformed or unsupported.');
  }

  if (architecture && manifest.architecture !== architecture) {
    fail(
      `Windows build/runtime manifest architecture mismatch: ` +
      `${manifest.architecture} != ${architecture}`
    );
  }

  if (network && manifest.network !== network) {
    fail(
      `Windows build/runtime manifest network mismatch: ` +
      `${manifest.network} != ${network}`
    );
  }

  const files = new Set();

  for (const runtime of manifest.runtime) {
    if (
      !runtime ||
      typeof runtime.file !== 'string' ||
      !/^[A-Za-z0-9_.+\-]+\.dll$/i.test(runtime.file) ||
      !Number.isSafeInteger(runtime.size) ||
      runtime.size <= 0 ||
      !/^[a-f0-9]{64}$/i.test(runtime.sha256 || '') ||
      runtime.architecture !== manifest.architecture ||
      typeof runtime.package !== 'string' ||
      typeof runtime.packageVersion !== 'string' ||
      !Array.isArray(runtime.dependencies)
    ) {
      fail('Windows build/runtime manifest contains an invalid runtime entry.');
    }

    const key = runtime.file.toLowerCase();

    if (files.has(key)) {
      fail(`Duplicate runtime DLL in manifest: ${runtime.file}`);
    }

    files.add(key);
  }

  return manifest;
}

function writeWindowsBuildRuntimeManifest(file, manifest) {
  validateWindowsBuildRuntimeManifest(manifest);

  fs.writeFileSync(
    file,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function readWindowsBuildRuntimeManifest(
  file,
  options = {}
) {
  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(
      `Unable to read Windows build/runtime manifest ${file}: ${error.message}`
    );
  }

  return validateWindowsBuildRuntimeManifest(manifest, options);
}

function isolatedWindowsPath(runtimeDirectory) {
  const systemRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    'C:\\Windows';

  return [
    runtimeDirectory,
    path.join(systemRoot, 'System32'),
    systemRoot
  ].join(';');
}

module.exports = Object.freeze({
  WINDOWS_BUILD_RUNTIME_MANIFEST,
  sha256,
  detectPeArchitecture,
  findWindowsBash,
  windowsRuntimeDirectory,
  discoverWindowsBuildRuntime,
  validateWindowsBuildRuntimeManifest,
  writeWindowsBuildRuntimeManifest,
  readWindowsBuildRuntimeManifest,
  isolatedWindowsPath
});
