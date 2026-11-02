'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const helper = require('../windows-update-tools');
const { registerCryLoCommand } = require('../../electron/build/windows-installer-runtime');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo update fixture '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('CLI contains no remaining PowerShell calls', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/crylo.js'), 'utf8');
  assert.doesNotMatch(source, /windowsPowerShellExecutable|Expand-Archive|New-Object -ComObject/);
  assert.match(source, /listBundle\(release.bundlePath\)/);
  assert.match(source, /registerCryLoCommand\(root, localAppData, systemRoot\)/);
});

test('archive validation rejects traversal, aliases, duplicate names and links before extraction', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/windows-update-tools.js'), 'utf8');
  for (const names of [['../outside'], ['a/b'], ['a\\b'], ['file:stream'], ['NUL.txt'], ['a.'], ['a '], ['a', 'A']]) {
    const context = { module: { exports: {} }, process: { env: { SystemRoot: '/Windows' } }, __dirname: root,
      require(name) {
        if (name === 'node:fs') return { existsSync: () => true };
        if (name === 'node:path') return path;
        if (name === 'node:child_process') return { spawnSync(tool, args) {
          assert.ok(args[0] === '-tf' || args[0] === '-tvf');
          return { status: 0, stdout: (args[0] === '-tf' ? names : names.map(n => '-rw-r--r-- ' + n)).join('\n') + '\n' };
        } };
        throw new Error(name);
      } };
    vm.runInNewContext(source, context);
    assert.throws(() => context.module.exports.listBundle('fixture.zip'), /Unsafe or duplicate/);
  }
});

test('shared CLI registration preserves registry type and existing PATH, and rolls back its wrapper on failure', t => {
  const dir = temporary(t);
  const checkout = path.join(dir, 'CryLo');
  fs.mkdirSync(checkout);
  fs.writeFileSync(path.join(checkout, 'crylo.cmd'), '@echo off\r\n');
  const reg = path.join(dir, 'reg.exe');
  fs.writeFileSync(reg, 'test placeholder');
  const existingPath = '%USERPROFILE%\\Tools;C:\\Existing Tools';
  const query = () => ({ status: 0, stdout: '    Path    REG_EXPAND_SZ    ' + existingPath + '\r\n' });
  const writes = [];
  assert.throws(() => registerCryLoCommand(dir, dir, dir, {
    userProfile: dir, regExe: reg, spawnSync: query, run: () => {}
  }), /Managed CryLo checkout must be/);
  registerCryLoCommand(checkout, dir, dir, { userProfile: dir, regExe: reg, spawnSync: query, run: (tool, args) => writes.push(args) });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][writes[0].indexOf('/t') + 1], 'REG_EXPAND_SZ');
  assert.equal(writes[0][writes[0].indexOf('/d') + 1], path.join(dir, 'CryLo', 'bin-v2') + ';' + existingPath);
  const wrapper = path.join(dir, 'CryLo/bin-v2/crylo.cmd');
  const before = fs.readFileSync(wrapper);
  assert.throws(() => registerCryLoCommand(checkout, dir, dir, { userProfile: dir, regExe: reg, spawnSync: query, run: () => { throw new Error('registry denied'); } }), /registry denied/);
  assert.deepEqual(fs.readFileSync(wrapper), before);
});

// Minimal stored ZIP fixtures with explicit Unix entry modes; no npm packages.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, text, mode = 0o100644] of entries) {
    const n = Buffer.from(name), data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE((mode * 65536) >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += h.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('Windows system tar extracts real ZIP bytes and refuses unsafe names and symlink entries', { skip: process.platform !== 'win32' }, t => {
  const dir = temporary(t), bundle = path.join(dir, 'signed fixture.zip'), out = path.join(dir, 'extracted');
  fs.mkdirSync(out);
  fs.writeFileSync(bundle, zip([['CryLo-daemon.exe', 'native fixture'], ['BINARY-MANIFEST.txt', 'manifest fixture'], ['libstdc++-6.dll', 'runtime fixture']]));
  const names = helper.listBundle(bundle);
  assert.deepEqual(names, ['CryLo-daemon.exe', 'BINARY-MANIFEST.txt', 'libstdc++-6.dll']);
  helper.extractBundle(bundle, out);
  assert.equal(fs.readFileSync(path.join(out, names[0]), 'utf8'), 'native fixture');
  for (const entries of [[['../outside', 'bad']], [['a', 'one'], ['A', 'two']], [['link', '../outside', 0o120777]]]) {
    fs.writeFileSync(bundle, zip(entries));
    assert.throws(() => helper.listBundle(bundle), /regular files|Unsafe or duplicate/);
  }
  assert.equal(fs.existsSync(path.join(dir, 'outside')), false);
});

test('Windows Script Host creates usable daemon shortcuts with literal paths', { skip: process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' }, t => {
  // This test only touches the disposable GitHub runner account's shortcuts.
  const dir = temporary(t), launcher = path.join(dir, 'daemon & fixture.cmd');
  fs.writeFileSync(launcher, '@echo off\r\nexit /b 0\r\n');
  const cmd = helper.systemTool('cmd.exe');
  helper.createDaemonShortcuts({ CRYLO_COMMAND_PROCESSOR: cmd, CRYLO_DAEMON_LAUNCHER: launcher, CRYLO_ROOT: dir, CRYLO_DAEMON_ICON: cmd });
  const verify = path.join(dir, 'verify.js');
  fs.writeFileSync(verify, `var s=new ActiveXObject('WScript.Shell'); var f=new ActiveXObject('Scripting.FileSystemObject'); var names=['Desktop','Programs']; for(var i=0;i<names.length;i++){var p=f.BuildPath(s.SpecialFolders(names[i]),'CryLo Daemon.lnk'); var l=s.CreateShortcut(p); WScript.Echo(l.TargetPath); WScript.Echo(l.Arguments); WScript.Echo(l.WorkingDirectory); f.DeleteFile(p,true);}`);
  const result = spawnSync(helper.systemTool('cscript.exe'), ['//nologo', '//E:JScript', verify], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 6);
  for (const offset of [0, 3]) {
    assert.equal(lines[offset].toLowerCase(), cmd.toLowerCase());
    assert.equal(lines[offset + 1], '/d /c ""' + launcher + '""');
    assert.equal(lines[offset + 2].toLowerCase(), dir.toLowerCase());
  }
});
