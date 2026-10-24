'use strict';

// Produce a conventional macOS package that installs both user-facing apps.
// No postinstall scripts, daemon start, or mutation of user-owned data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronDir = path.resolve(__dirname, '..');
const arch = process.argv[2];
if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(arch)) {
  throw new Error('macOS pkg generation requires darwin and x64 or arm64.');
}
const archName = arch === 'x64' ? 'x86_64' : 'arm64';
const appOut = path.join(electronDir, 'dist', arch === 'x64' ? 'mac' : 'mac-arm64');
const wallet = path.join(appOut, 'CryLo Wallet.app');
const daemon = path.join(appOut, 'CryLo Daemon.app');
const walletDaemon = path.join(wallet, 'Contents', 'Resources', 'bin', 'mac', 'CryLo-daemon');
const walletExecutable = path.join(wallet, 'Contents', 'MacOS', 'CryLo Wallet');
const version = require(path.join(electronDir, 'package.json')).version;
const pkg = path.join(electronDir, 'dist', `CryLo-${version}-mac-${arch}-unsigned.pkg`);

function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed: ${result.stderr || result.error}`);
  }
  return (result.stdout || '').trim();
}
function verifyArch(file) {
  const architectures = command('/usr/bin/lipo', ['-archs', file]).split(/\s+/);
  if (!architectures.includes(archName) || architectures.some(x => x !== archName)) {
    throw new Error(`Architecture mismatch ${file}: expected only ${archName}, found ${architectures}`);
  }
}
verifyArch(walletDaemon);
verifyArch(walletExecutable);
if (fs.existsSync(daemon)) fs.rmSync(daemon, { recursive: true, force: true });
const macos = path.join(daemon, 'Contents', 'MacOS');
const resources = path.join(daemon, 'Contents', 'Resources');
fs.mkdirSync(macos, { recursive: true });
fs.mkdirSync(resources, { recursive: true });
const executable = path.join(macos, 'CryLo Daemon');
const embedded = path.join(resources, 'CryLo-daemon');
fs.copyFileSync(walletDaemon, embedded);
fs.chmodSync(embedded, 0o755);
const launcher = `#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DAEMON="$HERE/../Resources/CryLo-daemon"
DATA="$HOME/Library/Application Support/CryLo"
mkdir -p "$DATA"
CONFIG="$DATA/CryLo.conf"
if [ ! -e "$CONFIG" ]; then
  (umask 077; printf 'testnet=1\\nadd-priority-node=relay-us-1.crylo.network:22640\\n' > "$CONFIG")
fi
exec "$DAEMON" --config-file "$CONFIG" --data-dir "$DATA"
`;
fs.writeFileSync(executable, launcher, { mode: 0o755 });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.crylo.daemon</string>
<key>CFBundleName</key><string>CryLo Daemon</string>
<key>CFBundleDisplayName</key><string>CryLo Daemon</string>
<key>CFBundleExecutable</key><string>CryLo Daemon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`;
fs.writeFileSync(path.join(daemon, 'Contents', 'Info.plist'), plist);
verifyArch(embedded);
command('/usr/bin/plutil', ['-lint', path.join(daemon, 'Contents', 'Info.plist')]);
command('/bin/sh', ['-n', executable]);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-mac-pkg-'));
try {
  const apps = path.join(stage, 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  fs.cpSync(wallet, path.join(apps, 'CryLo Wallet.app'), { recursive: true });
  fs.cpSync(daemon, path.join(apps, 'CryLo Daemon.app'), { recursive: true });
  command('/usr/bin/pkgbuild', [
    '--root', stage,
    '--identifier', 'com.crylo.installer',
    '--version', version,
    '--install-location', '/',
    pkg
  ]);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
command('/usr/sbin/pkgutil', ['--check-signature', pkg]); // diagnostic: unsigned pkg expected
console.log(`Created unsigned macOS ${arch} installer: ${pkg}`);
