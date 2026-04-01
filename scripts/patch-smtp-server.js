'use strict';

const fs = require('node:fs');
const path = require('node:path');

const patches = [
  {
    filePath: path.join(__dirname, '..', 'node_modules', 'smtp-server', 'lib', 'smtp-stream.js'),
    original: '    this.closed = false;',
    replacement: [
      '    try {',
      '        this.closed = false;',
      '    } catch (err) {',
      '        this._closed = false;',
      '    }'
    ].join('\n')
  },
  {
    filePath: path.join(__dirname, '..', 'node_modules', 'smtp-server', 'lib', 'smtp-connection.js'),
    original: '        this._parser.closed = true;',
    replacement: [
      '        try {',
      '            this._parser.closed = true;',
      '        } catch (err) {',
      '            this._parser._closed = true;',
      '        }'
    ].join('\n')
  }
];

let patchedCount = 0;

for (const patch of patches) {
  if (!fs.existsSync(patch.filePath)) {
    continue;
  }

  const source = fs.readFileSync(patch.filePath, 'utf8');
  if (source.includes(patch.replacement)) {
    continue;
  }

  if (!source.includes(patch.original)) {
    console.warn(`[patch-smtp-server] target line not found in ${path.basename(patch.filePath)}, skipping patch`);
    continue;
  }

  fs.writeFileSync(patch.filePath, source.replace(patch.original, patch.replacement), 'utf8');
  patchedCount += 1;
}

if (patchedCount > 0) {
  console.log(`[patch-smtp-server] applied ${patchedCount} smtp-server compatibility patch(es)`);
}
