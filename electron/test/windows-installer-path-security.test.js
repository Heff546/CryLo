'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  assertExistingPathIsNotReparse,
  assertTreeHasNoReparse
} = require('../build/windows-installer-runtime');

if (process.platform !== 'win32') throw new Error('Windows-only test');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-installer-path-'));
const junction = path.join(base, 'junction');
let checks = 0;

function accepts(fn, label) {
  assert.doesNotThrow(fn, label);
  console.log(`PASS: ${label}`);
  checks++;
}

function rejects(fn, label) {
  assert.throws(fn, label);
  console.log(`PASS: ${label}`);
  checks++;
}

try {
  const ordinary = path.join(base, 'ordinary');
  const nested = path.join(ordinary, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'safe.txt'), 'ok');

  accepts(() => assertExistingPathIsNotReparse(nested, 'ordinary path'), 'ordinary path accepted');
  accepts(() => assertTreeHasNoReparse(ordinary, 'ordinary tree'), 'ordinary tree accepted');

  // Native Node junction creation avoids Windows cmd.exe /S quoting ambiguity.
  fs.symlinkSync(ordinary, junction, 'junction');
  assert.equal(fs.lstatSync(junction).isSymbolicLink(), true, 'junction was not created');
  rejects(() => assertExistingPathIsNotReparse(junction, 'direct junction'), 'direct junction rejected');
  rejects(() => assertExistingPathIsNotReparse(path.join(junction, 'nested'), 'junction traversal'), 'junction traversal rejected');
  rejects(() => assertTreeHasNoReparse(base, 'tree with junction'), 'tree containing junction rejected');

  // Windows runners may disable 8.3 aliases; absence is a SKIP, never a PASS.
  let short = '';
  try {
    short = execFileSync(
      'cmd.exe',
      ['/D', '/C', `for %I in ("${ordinary}") do @echo %~sI`],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    ).trim();
  } catch (error) {
    console.log(`SKIP: 8.3 alias lookup unavailable (${error.message})`);
  }
  if (short && fs.existsSync(short) && short.toLowerCase() !== ordinary.toLowerCase()) {
    accepts(() => assertExistingPathIsNotReparse(short, '8.3 alias'), 'ordinary 8.3 alias accepted');
    accepts(() => assertTreeHasNoReparse(short, '8.3 tree'), 'ordinary 8.3 tree accepted');
  } else {
    console.log('SKIP: 8.3 alias unavailable; do not count as PASS');
  }

  console.log(`PATH_SECURITY_GATE=PASS CHECKS=${checks}`);
} finally {
  // Remove the junction itself before its containing directory.
  if (fs.existsSync(junction)) fs.rmdirSync(junction);
  fs.rmSync(base, { force: true, recursive: true });
}
