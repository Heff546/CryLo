'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { stageWindowsInstallerHelper } = require('../../electron/scripts/before-pack');
function git(cwd, ...args) {
  const r = spawnSync('git', args, {cwd, encoding:'utf8', shell:false});
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
function wrapper(source) {
  const marker = "const marker = ':: CryLo managed snapshot launcher v2';";
  const start = source.indexOf('const wrapper = ', source.indexOf(marker));
  const end = source.indexOf("].join('\\r\\n');", start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(source.slice(start + 'const wrapper = '.length, end + 1), {marker:':: CryLo managed snapshot launcher v2'}).join('\r\n');
}
test('existing v2 launcher template is retained byte-for-byte', () => {
  const old = git(root, 'show', '5c7a5ac842eda8f143abacfe6b4e8c22161e0931:electron/build/windows-installer-runtime.js');
  const current = fs.readFileSync(path.join(root,'electron/build/windows-installer-runtime.js'),'utf8');
  assert.equal(wrapper(current), wrapper(old));
});
test('generated helper hash requires committed bytes and rejects local tampering', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-helper-pin-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const build = path.join(dir,'electron/build'); fs.mkdirSync(build,{recursive:true});
  for(const name of ['installer.nsh','windows-installer-runtime.js']) fs.copyFileSync(path.join(root,'electron/build',name),path.join(build,name));
  git(dir,'init'); git(dir,'add','.');
  git(dir,'-c','user.name=CI','-c','user.email=ci@invalid.example','commit','-m','reviewed helper fixture');
  const result = stageWindowsInstallerHelper(path.join(dir,'electron'));
  assert.match(fs.readFileSync(result.pinFile,'ascii'),new RegExp(result.hash));
  const helper=path.join(build,'windows-installer-runtime.js'); fs.appendFileSync(helper,'\n// tampered\n');
  assert.throws(()=>stageWindowsInstallerHelper(path.join(dir,'electron')), /differs from the reviewed Git HEAD/);
});
test('all NSIS log append opens seek to EOF', () => {
  const source = fs.readFileSync(path.join(root,'electron/build/installer.nsh'),'utf8');
  const opens = [...source.matchAll(/FileOpen \$8 "\$LOCALAPPDATA\\CryLo\\installer-bootstrap\.log" a\r?\n([^\n]*)/g)];
  assert.ok(opens.length > 10);
  opens.forEach(m => assert.equal(m[1].trim(), 'FileSeek $8 0 END'));
});
