'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

function loadEnv() {
  const cwd = process.cwd();
  const explicitPath = process.env.FORSAKEN_MAIL_ENV_FILE;

  if (explicitPath) {
    loadEnvFile(path.resolve(cwd, explicitPath));
    return;
  }

  loadEnvFile(path.join(cwd, '.env'));
}

module.exports = {
  parseEnv,
  loadEnvFile,
  loadEnv,
};
