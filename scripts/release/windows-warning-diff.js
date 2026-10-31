'use strict';
const fs = require('node:fs');

// Group by stable diagnostic type, not runner directory or log timestamps.
function warnings(log) {
  const out = {};
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/, '').trim();
    let key, m;
    if ((m = line.match(/^npm warn deprecated\s+(\S+?)(?::|\s)/i))) {
      key = 'npm-deprecated:' + m[1];
    } else if ((m = line.match(/^CMake Warning(?:\s*\(([^)]+)\))? at (\S+:\d+)\s*\(/i))) {
      key = 'cmake:' + (m[1] || 'general') + ':' + m[2];
    } else if ((m = line.match(/^(\S+?):(\d+):(\d+):\s*warning:\s*(.+)$/i))) {
      const path = m[1].replace(/\\/g, '/').replace(/^.*?\/(src|tests|external|scripts|contrib)\//, '$1/');
      key = 'compiler:' + path + ':' + m[4];
    } else if ((m = line.match(/^warning:\s*(.+)$/i))) {
      key = 'package-warning:' + m[1];
    } else if ((m = line.match(/^ModuleNotFoundError: No module named ['"]([^'"]+)['"]$/))) {
      key = 'python-missing-module:' + m[1];
    } else if (/^Monero crypto autodetect failed to find any libraries for target platform$/.test(line)) {
      key = 'crypto:internal-fallback';
    } else if ((m = line.match(/^Could NOT find (Readline|GTest)\b/i))) {
      key = 'optional-dependency:' + m[1].toLowerCase();
    } else if (/^ccache NOT found!/.test(line)) {
      key = 'build-speed:ccache-absent';
    } else if (/^NOTICE: \d+ historical Monero wallet tests remain unvalidated/.test(line)) {
      key = 'test-coverage:historical-wallet-fixture-missing';
    }
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}
function compare(oldText, newText) {
  const old = warnings(oldText), now = warnings(newText);
  const count = x => Object.values(x).reduce((a,b) => a + b, 0);
  return {
    schema: 2,
    classification: 'WINDOWS_WARNING_REVIEW_ONLY',
    releaseFrozen: true,
    mayPublish: false,
    priorWarningLines: count(old),
    currentWarningLines: count(now),
    currentDiagnostics: Object.keys(now).sort().map(key => ({key, count: now[key]})),
    newDiagnostics: Object.keys(now).filter(key => !(key in old)).sort().map(key => ({key, count: now[key]})),
    preexistingDiagnostics: Object.keys(now).filter(key => key in old).sort().map(key => ({key, prior: old[key], current: now[key]})),
    notInCurrent: Object.keys(old).filter(key => !(key in now)).sort().map(key => ({key, prior: old[key]}))
  };
}
if (require.main === module) {
  const [old, newer, out] = process.argv.slice(2);
  if (!old || !newer || !out) throw Error('Two logs and report path required');
  const result = compare(fs.readFileSync(old, 'utf8'), fs.readFileSync(newer, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  console.log('current diagnostics: ' + result.currentDiagnostics.length +
    ' new: ' + result.newDiagnostics.length +
    ' retained: ' + result.preexistingDiagnostics.length +
    ' no longer present: ' + result.notInCurrent.length);
  console.log('RELEASE FROZEN; this report cannot authorize publication.');
}
module.exports = {warnings, compare};
