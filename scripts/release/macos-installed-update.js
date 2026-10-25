'use strict';
// The installed-PKG Terminal entry point. No Git, Homebrew, or privileged installer.
// Authentication is enforced by the same client and pinned Pi1 trust resources
// used by the installed Electron wallet.
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');
const update = require('./macos-update-client');

async function main() {
  if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error('CryLo update requires native Intel or Apple Silicon macOS.');
  }
  const home = os.homedir();
  const context = {
    resourcesPath: path.resolve(__dirname, '..'),
    userData: path.join(home, 'Library', 'Application Support', 'CryLo Wallet'),
    home
  };
  console.log('===== CRYLO UPDATE =====');
  console.log('Architecture: mac/' + process.arch);
  console.log('Checking official Pi1-authenticated CryLo releases...');
  const candidate = await update.discoverVerifiedMacRelease(context);
  if (!candidate) {
    console.log('No eligible Pi1-authorized CryLo Mac release is available.');
    return;
  }
  console.log('Available: ' + candidate.tag + ' (' + candidate.artifact.file + ')');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive Terminal approval is required before downloading.');
  }
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try { answer = await input.question('Download and verify this installer? [y/N] '); }
  finally { input.close(); }
  if (!/^(y|yes)$/i.test(answer.trim())) {
    console.log('Cancelled; no installer was executed.');
    return;
  }
  const staged = await update.downloadAndStageMacUpdate(context, candidate);
  console.log('Pi1 verification passed: ' + staged.releaseTag);
  console.log('SHA-256: ' + staged.sha256);
  console.log('Installer: ' + staged.stagedPath);
  const opened = spawnSync('/usr/bin/open', ['-a', 'Installer', staged.stagedPath], {
    stdio: 'inherit', shell: false
  });
  if (opened.error || opened.status !== 0) {
    throw new Error('Could not open macOS Installer. The verified package remains at ' +
      staged.stagedPath);
  }
  console.log('Installer opened for user approval. Installation is NOT yet complete.');
  console.log('Gatekeeper has not been disabled; release rollback state was not advanced.');
}

main().catch(error => {
  console.error('ERROR: CryLo update failed: ' + String(error && error.message || error));
  process.exitCode = 1;
});
