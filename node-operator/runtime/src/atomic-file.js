'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  await fs.mkdir(directory, {
    recursive: true,
    mode: 0o750
  });

  const serialized =
    `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(
    temporaryPath,
    serialized,
    {
      encoding: 'utf8',
      mode: 0o640,
      flag: 'wx'
    }
  );

  await fs.rename(temporaryPath, filePath);
}

module.exports = {
  writeJsonAtomic
};
