'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ELECTRON_BUILDER_ARCH = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
};

const WINDOWS_NODE_VERSION = '24.21.0';
const WINDOWS_NODE_NAME =
  `node-v${WINDOWS_NODE_VERSION}-win-x64`;
const WINDOWS_NODE_ARCHIVE =
  `${WINDOWS_NODE_NAME}.zip`;
const WINDOWS_NODE_SHA256 =
  '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
const WINDOWS_NODE_URL =
  `https://nodejs.org/dist/v${WINDOWS_NODE_VERSION}/${WINDOWS_NODE_ARCHIVE}`;

function runChecked(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Packaging check failed: ${label}`);
  }
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(
        new Error(
          `Too many redirects while downloading ${url}`
        )
      );
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'CryLo-Release-Builder'
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          const nextUrl =
            new URL(
              response.headers.location,
              url
            ).toString();

          downloadFile(
            nextUrl,
            destination,
            redirects + 1
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Node.js download failed with HTTP ${statusCode}`
            )
          );
          return;
        }

        const output =
          fs.createWriteStream(destination, {
            flags: 'wx'
          });

        output.on('error', reject);

        response.on('error', reject);

        output.on('finish', () => {
          output.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });

        response.pipe(output);
      }
    );

    request.on('error', reject);
  });
}

async function stageWindowsNodeInstallerResource(
  electronDir
) {
  const buildDir =
    path.join(
      electronDir,
      'build'
    );

  const destination =
    path.join(
      buildDir,
      WINDOWS_NODE_ARCHIVE
    );

  fs.mkdirSync(
    buildDir,
    {
      recursive: true
    }
  );

  if (fs.existsSync(destination)) {
    const stat =
      fs.lstatSync(destination);

    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `Invalid staged Node.js installer resource: ${destination}`
      );
    }

    const existingHash =
      sha256(destination);

    if (
      existingHash ===
      WINDOWS_NODE_SHA256
    ) {
      console.log(
        `Verified staged Node.js installer resource: ${WINDOWS_NODE_ARCHIVE}`
      );
      return;
    }

    fs.unlinkSync(destination);
  }

  const temporary =
    `${destination}.tmp-${process.pid}`;

  if (fs.existsSync(temporary)) {
    fs.unlinkSync(temporary);
  }

  try {
    console.log(
      `Downloading authenticated Node.js ${WINDOWS_NODE_VERSION} installer resource...`
    );

    await downloadFile(
      WINDOWS_NODE_URL,
      temporary
    );

    const downloadedHash =
      sha256(temporary);

    if (
      downloadedHash !==
      WINDOWS_NODE_SHA256
    ) {
      throw new Error(
        'Downloaded Node.js archive SHA256 mismatch.\n' +
        `Expected: ${WINDOWS_NODE_SHA256}\n` +
        `Actual:   ${downloadedHash}`
      );
    }

    fs.renameSync(
      temporary,
      destination
    );
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }

  const finalStat =
    fs.lstatSync(destination);

  if (
    !finalStat.isFile() ||
    finalStat.isSymbolicLink()
  ) {
    throw new Error(
      `Invalid staged Node.js installer resource: ${destination}`
    );
  }

  const finalHash =
    sha256(destination);

  if (
    finalHash !==
    WINDOWS_NODE_SHA256
  ) {
    throw new Error(
      'Staged Node.js installer resource failed final SHA256 verification.'
    );
  }

  console.log(
    `Staged authenticated Node.js installer resource: ${WINDOWS_NODE_ARCHIVE}`
  );
}

module.exports = async function beforePack(context) {
  const electronDir = path.resolve(__dirname, '..');
  const targetArch =
    ELECTRON_BUILDER_ARCH[context.arch] || String(context.arch);

  if (context.electronPlatformName === 'linux') {
    for (const script of [
      'scripts/sync-linux-binaries.sh',
      'scripts/verify-linux-binaries.sh'
    ]) {
      runChecked(
        'bash',
        [script],
        electronDir,
        script
      );
    }

    const daemon = path.join(
      electronDir,
      'bin',
      'linux',
      'CryLo-daemon'
    );

    const binaryArch = execFileSync(
      path.join(
        electronDir,
        'scripts',
        'detect-linux-binary-arch.sh'
      ),
      [daemon],
      { encoding: 'utf8' }
    ).trim();

    if (binaryArch !== targetArch) {
      throw new Error(
        `Electron target ${targetArch} cannot contain ` +
        `${binaryArch} CryLo binaries`
      );
    }

    console.log(
      `Verified Electron target ${targetArch} matches CryLo binaries`
    );
    return;
  }

  const platform =
    context.electronPlatformName === 'win32'
      ? 'win'
      : context.electronPlatformName === 'darwin'
        ? 'mac'
        : null;

  if (!platform) {
    return;
  }

  if (platform === 'win' && targetArch !== 'x64') {
    throw new Error(
      `Unsupported Windows Electron architecture: ${targetArch}`
    );
  }

  if (
    platform === 'mac' &&
    !['x64', 'arm64'].includes(targetArch)
  ) {
    throw new Error(
      `Unsupported macOS Electron architecture: ${targetArch}`
    );
  }

  for (const script of [
    'sync-native-binaries.js',
    'verify-native-binaries.js'
  ]) {
    runChecked(
      process.execPath,
      [
        path.join(electronDir, 'scripts', script),
        platform,
        targetArch
      ],
      electronDir,
      script
    );
  }

  if (platform === 'win') {
    await stageWindowsNodeInstallerResource(
      electronDir
    );
  }

  console.log(
    `Verified Electron target ${platform}/${targetArch} ` +
    'matches CryLo binaries'
  );
};
