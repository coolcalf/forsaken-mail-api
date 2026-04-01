'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnv } = require('../modules/env');

test('parseEnv reads simple key value pairs', () => {
  const parsed = parseEnv([
    '# comment',
    'PORT=3000',
    'FORSAKEN_MAIL_DOMAINS=mail.sfz234.com',
    'FORSAKEN_MAIL_DB_PATH=/data/main.db'
  ].join('\n'));

  assert.equal(parsed.PORT, '3000');
  assert.equal(parsed.FORSAKEN_MAIL_DOMAINS, 'mail.sfz234.com');
  assert.equal(parsed.FORSAKEN_MAIL_DB_PATH, '/data/main.db');
});
