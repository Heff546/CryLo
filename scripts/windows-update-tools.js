'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function systemTool(name) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('Windows SystemRoot is required.');
  const tool = path.join(systemRoot, 'System32', name);
  if (!fs.existsSync(tool)) throw new Error(`Required Windows system tool is unavailable: ${tool}`);
  return tool;
}

function invoke(tool, args, options = {}) {
  const result = spawnSync(tool, args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Windows tool failed: ${path.basename(tool)}: ${result.error?.message || result.stderr || result.status}`);
  }
  return String(result.stdout || '');
}

function listBundle(bundle) {
  const tar = systemTool('tar.exe');
  // Check entry types before extraction: a signed bundle must still never
  // create links, directories, or devices in the installation staging area.
  const types = invoke(tar, ['-tvf', bundle]).split(/\r?\n/).filter(Boolean);
  const entries = invoke(tar, ['-tf', bundle]).split(/\r?\n/).filter(Boolean);
  if (!entries.length || types.length !== entries.length || types.some(line => !line.startsWith('-'))) {
    throw new Error('Windows release bundle must contain regular files only.');
  }
  const seen = new Set();
  for (const entry of entries) {
    // Restrict Windows filenames, including alternate streams, device names,
    // trailing dot/space aliases, and case-insensitive duplicates.
    if (!/^[A-Za-z0-9][A-Za-z0-9._+ -]*$/.test(entry) || /[. ]$/.test(entry) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(entry) || seen.has(entry.toLowerCase())) {
      throw new Error(`Unsafe or duplicate Windows bundle entry: ${entry}`);
    }
    seen.add(entry.toLowerCase());
  }
  return entries;
}

function extractBundle(bundle, directory) {
  invoke(systemTool('tar.exe'), ['-xf', bundle, '-C', directory]);
}

function createDaemonShortcuts(values) {
  // Data is passed through the process environment, never interpolated into
  // script source or a command shell. WSH resolves redirected special folders.
  invoke(systemTool('cscript.exe'), ['//nologo', '//E:JScript', path.join(__dirname, 'windows-daemon-shortcuts.js')], {
    env: { ...process.env, ...values }
  });
}

module.exports = { systemTool, listBundle, extractBundle, createDaemonShortcuts };
