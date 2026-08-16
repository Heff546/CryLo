'use strict';

const fs = require('fs');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function detectPe(buffer) {
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    return null;
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 > buffer.length) {
    fail('Truncated PE header.');
  }

  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    fail('Invalid PE signature.');
  }

  const machine = buffer.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return 'x64';
  if (machine === 0xaa64) return 'arm64';

  fail(`Unsupported PE machine type: 0x${machine.toString(16)}`);
}

function detectMachO(buffer) {
  if (buffer.length < 8) return null;

  const magicBE = readUInt32BE(buffer, 0);
  const magicLE = readUInt32LE(buffer, 0);

  // Thin Mach-O.
  let littleEndian = null;
  if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
    littleEndian = true;
  } else if (magicBE === 0xfeedfacf || magicBE === 0xfeedface) {
    littleEndian = false;
  }

  if (littleEndian !== null) {
    const cpuType = littleEndian
      ? readUInt32LE(buffer, 4)
      : readUInt32BE(buffer, 4);

    if (cpuType === 0x01000007) return 'x64';
    if (cpuType === 0x0100000c) return 'arm64';

    fail(`Unsupported Mach-O CPU type: 0x${cpuType.toString(16)}`);
  }

  // Universal/fat Mach-O is deliberately rejected for CryLo native runtime
  // payloads. Electron releases are built and verified per architecture.
  if (
    magicBE === 0xcafebabe ||
    magicBE === 0xcafebabf ||
    magicLE === 0xcafebabe ||
    magicLE === 0xcafebabf
  ) {
    fail(
      'Universal Mach-O binaries are not accepted for the CryLo runtime. ' +
      'Build a thin x64 or arm64 runtime.'
    );
  }

  return null;
}

if (process.argv.length !== 3) {
  fail('Usage: node detect-native-binary-arch.js <binary>');
}

const binaryPath = process.argv[2];
const buffer = fs.readFileSync(binaryPath);

const arch = detectPe(buffer) || detectMachO(buffer);
if (!arch) {
  fail(`Unsupported native binary format: ${binaryPath}`);
}

process.stdout.write(`${arch}\n`);
