#!/usr/bin/env node
// SPDX-License-Identifier: MIT
'use strict';
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { resolve, join, dirname, relative, isAbsolute } = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: fullbleed-browser-assets OUTPUT_DIRECTORY\nCopies the browser client, worker, engine, fonts and license notices. Existing runtime files in the named directory are replaced.');
    return;
  }
  if (args.length !== 1 || args[0].startsWith('-') || !args[0].trim()) throw new Error('Pass one output directory, for example: fullbleed-browser-assets public/fullbleed');
  const root = resolve(__dirname, '..');
  const destination = resolve(args[0]);
  const inside = relative(root, destination);
  if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) throw new Error('Choose an output directory outside the installed Fullbleed package.');
  const manifest = JSON.parse(await readFile(join(root, 'dist/browser/asset-manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.schema !== 'fullbleed.browser-assets.v1' || manifest.packageVersion !== pkg.version || manifest.engineVersion !== pkg.fullbleed.engineVersion) throw new Error('The browser build does not match the installed package.');
  const files = [];
  for (const [name, record] of Object.entries(manifest.files)) {
    for (const path of [name, record.source]) {
      if (typeof path !== 'string' || /[\\:\0]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The browser asset manifest contains an invalid path.');
    }
    const data = await readFile(join(root, record.source));
    if (data.length !== record.bytes || createHash('sha256').update(data).digest('hex') !== record.sha256) throw new Error('The installed browser asset failed verification: ' + name);
    files.push({ name, data, bytes: record.bytes, sha256: record.sha256 });
  }
  // Verify the complete installed set before writing any output files.
  for (const file of files) {
    const path = join(destination, file.name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.data);
  }
  await writeFile(join(destination, 'build.json'), JSON.stringify({ schema: manifest.schema,
    packageVersion: pkg.version, engineVersion: manifest.engineVersion, engineFeatures: manifest.engineFeatures,
    files: Object.fromEntries(files.map(({ name, bytes, sha256 }) => [name, { bytes, sha256 }])) }, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, directory: destination, packageVersion: pkg.version,
    engineVersion: manifest.engineVersion, files: files.length + 1, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
