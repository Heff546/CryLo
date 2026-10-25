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
const iconSource = path.join(electronDir, 'assets', 'icon.png');
if (!fs.existsSync(iconSource)) throw new Error('CryLo icon.png is missing');
// Use a private workspace: suffixing the mkdtemp path with .iconset
// would create a second, raceable path in a shared temporary directory.
const iconWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-iconset-'));
const iconset = path.join(iconWorkspace, 'CryLo.iconset');
fs.mkdirSync(iconset, { mode: 0o700 });
try {
  for (const [pixels, suffix] of [
    [16, '16x16'], [32, '16x16@2x'], [32, '32x32'],
    [64, '32x32@2x'], [128, '128x128'], [256, '128x128@2x'],
    [256, '256x256'], [512, '256x256@2x'], [512, '512x512'],
    [1024, '512x512@2x']
  ]) {
    command('/usr/bin/sips', [
      '-s', 'format', 'png', '-z', String(pixels), String(pixels),
      iconSource, '--out', path.join(iconset, 'icon_' + suffix + '.png')
    ]);
  }
  command('/usr/bin/iconutil', [
    '-c', 'icns', iconset, '-o', path.join(resources, 'CryLo.icns')
  ]);
} finally {
  fs.rmSync(iconWorkspace, { recursive: true, force: true });
}
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
<key>CFBundleIconFile</key><string>CryLo.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`;
fs.writeFileSync(path.join(daemon, 'Contents', 'Info.plist'), plist);
verifyArch(embedded);
const dmgSource = path.join(electronDir, 'build', 'mac-installer', 'CryLo Daemon.app');
fs.mkdirSync(path.dirname(dmgSource), { recursive: true });
fs.rmSync(dmgSource, { recursive: true, force: true });
fs.cpSync(daemon, dmgSource, { recursive: true });
command('/usr/bin/plutil', ['-lint', path.join(daemon, 'Contents', 'Info.plist')]);
command('/bin/sh', ['-n', executable]);
// Isolate payload and scripts under one mode-0700 mkdtemp workspace.
// Neither temporary scripts nor their path are shared between builds.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-mac-pkg-'));
const stage = path.join(workspace, 'root');
const scriptDir = path.join(workspace, 'scripts');
try {
  const apps = path.join(stage, 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  fs.cpSync(wallet, path.join(apps, 'CryLo Wallet.app'), { recursive: true });
  fs.cpSync(daemon, path.join(apps, 'CryLo Daemon.app'), { recursive: true });
  fs.mkdirSync(scriptDir, { mode: 0o700 });
  const postinstall = path.join(scriptDir, 'postinstall');
  fs.writeFileSync(postinstall, `#!/bin/sh
set -eu
# Installer does not launch the daemon or alter existing user data.
user=$(/usr/bin/stat -f %Su /dev/console)
case "$user" in
  ''|root|loginwindow) exit 0 ;;
esac
uid=$(/usr/bin/id -u "$user") || exit 0
home=$(/usr/bin/dscl . -read "/Users/$user" NFSHomeDirectory | /usr/bin/awk '{print $2}') || exit 0
[ -n "$home" ] || exit 0
desktop="$home/Desktop"
[ -d "$desktop" ] || exit 0
for name in 'CryLo Wallet' 'CryLo Daemon'; do
  target="/Applications/$name.app"
  link="$desktop/$name.app"
  [ -d "$target" ] || continue
  [ ! -e "$link" ] && [ ! -L "$link" ] || continue
  /bin/ln -s "$target" "$link"
  /usr/sbin/chown -h "$uid" "$link"
done
exit 0
`, { mode: 0o755 });
  command('/bin/sh', ['-n', postinstall]);
  command('/usr/bin/pkgbuild', [
    '--root', stage,
    '--scripts', scriptDir,
    '--identifier', 'com.crylo.installer',
    '--version', version,
    '--install-location', '/',
    pkg
  ]);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
console.log(`Created unsigned macOS ${arch} installer: ${pkg}`);
