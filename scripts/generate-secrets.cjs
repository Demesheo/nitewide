#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const { DEVELOPMENT_SECRETS, SECRET_NAMES } = require('../apps/api/src/config');

function generateSecrets(existing = {}) {
  const values = {};
  for (const name of SECRET_NAMES) {
    const current = existing[name];
    const placeholder = Object.values(DEVELOPMENT_SECRETS).includes(current) || /replace[-_ ]?this|change[-_ ]?me|your[-_ ]?(secret|key)/i.test(current || '');
    if (current && !placeholder && current.length < 32) throw new Error(`${name} is configured but too short; correct it explicitly before continuing`);
    values[name] = current && !placeholder ? current : randomBytes(32).toString('hex');
  }
  if (new Set(Object.values(values)).size !== SECRET_NAMES.length) throw new Error('Existing secrets are reused across purposes; correct them explicitly');
  return values;
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || !['--output', '--env-file'].includes(args[0])) throw new Error('Use --output <new-secret-file> or --env-file <local-development-env-file>');
  const filename = path.resolve(args[1]);
  if (args[0] === '--output') {
    const values = generateSecrets();
    fs.writeFileSync(filename, SECRET_NAMES.map(name => `${name}=${values[name]}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Created a private file containing three independent 256-bit secrets. Values were not printed.');
    return;
  }
  const original = fs.readFileSync(filename, 'utf8');
  const existing = dotenv.parse(original);
  if (existing.NODE_ENV && existing.NODE_ENV !== 'development') throw new Error('--env-file initializes development only; generate a separate --output file for staging/production');
  const values = generateSecrets(existing);
  const updated = [];
  let content = original;
  for (const name of SECRET_NAMES) {
    const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, 'gm');
    const matches = [...content.matchAll(pattern)];
    if (matches.length > 1) throw new Error(`Remove duplicate ${name} assignments before initialization`);
    if (existing[name] === values[name]) continue;
    content = matches.length ? content.replace(pattern, `${name}=${values[name]}`) : content.replace(/\s*$/, '\n') + `${name}=${values[name]}\n`;
    updated.push(name);
  }
  fs.writeFileSync(filename, content, { mode: 0o600 });
  fs.chmodSync(filename, 0o600);
  console.log(updated.length ? `Initialized ${updated.join(', ')} in the local environment file. Values were not printed. Restart the API to load them.` : 'All three independent secrets are already configured; no values were rotated.');
}

if (require.main === module) {
  try { main(); } catch (error) {
    // Do not echo parsed environment data, filesystem contents or secret values.
    console.error(error.code ? `Secret initialization failed (${error.code}).` : error.message);
    process.exitCode = 1;
  }
}
module.exports = { generateSecrets, main };
