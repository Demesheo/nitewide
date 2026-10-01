#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { buildContract } = require('../src/http/contract-build');
const destination = path.resolve(__dirname, '../../../docs/api/openapi.json');
const output = `${JSON.stringify(buildContract().document, null, 2)}\n`;
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output);
  process.stdout.write('Updated docs/api/openapi.json\n');
} else if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) {
    process.stderr.write('API contract is stale. Run npm run api:contract and review the generated diff.\n');
    process.exitCode = 1;
  } else process.stdout.write('API contract matches the registered routes and schemas.\n');
} else process.stdout.write(output);
