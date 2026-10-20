// SPDX-License-Identifier: MIT
// Run the standalone example against the verified, isolated package installation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const pkg = await read(join(root, 'package.json'));
const packed = await read(join(root, 'output/pack-verification/verification.json'));
assert(packed.ok && packed.package === `fullbleed-${pkg.version}.tgz`);
const consumer = await mkdtemp(join(root, 'output/pack-verification', packed.installDirectory, 'cloudflare starter '));
const outputRoot = join(root, 'output/cloudflare-starter-verification');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
for (const file of ['package.json', 'wrangler.json', 'sample.json', 'LICENSE', 'README.md',
  'src/index.mjs', 'src/handler.mjs', 'src/document.mjs', 'src/styles.mjs',
  'test/fixtures.mjs', 'test/request.test.mjs', 'test/worker.mjs']) {
  await mkdir(dirname(join(consumer, file)), { recursive: true });
  await copyFile(join(root, 'examples/cloudflare', file), join(consumer, file));
}
const starter = await read(join(consumer, 'package.json'));
assert.equal(starter.dependencies.fullbleed, pkg.version, 'The starter must target this package.');
const env = { ...process.env, PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? ''),
  WRANGLER_SEND_METRICS: 'false' };
function run(args, timeout = 120000) {
  const child = spawnSync(process.execPath, args, { cwd: consumer, env, encoding: 'utf8', timeout });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return child.stdout + child.stderr;
}
await writeFile(join(output, 'input-tests.log'), run(['--test', 'test/request.test.mjs']));
await writeFile(join(consumer, 'baseline.mjs'), `
import { renderPdf, version, engineVersion } from 'fullbleed';
import { Invoice } from './src/document.mjs';
import { validateInvoice } from './src/handler.mjs';
import { cases } from './test/fixtures.mjs';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const output = process.argv[2];
const records = [];
for (const item of cases) {
  const data = validateInvoice(item.data);
  const result = await Invoice({ data }).renderPdf(renderPdf, { maxPages: 10, defaultStyles: false, previewDpi: 96 });
  await writeFile(join(output, item.name + '-node.pdf'), result.pdf);
  for (const [i, bytes] of result.previews.entries()) await writeFile(join(output, item.name + '-' + (i + 1) + '.png'), bytes);
  records.push({ name: item.name, pdf: createHash('sha256').update(result.pdf).digest('hex'),
    pages: result.pages, missingGlyphs: result.missingGlyphs,
    previews: result.previews.map(bytes => createHash('sha256').update(bytes).digest('hex')) });
}
await writeFile(join(output, 'node-baseline.json'), JSON.stringify({ version, engineVersion, records }, null, 2));
`);
await writeFile(join(output, 'baseline.log'), run(['baseline.mjs', output]));
const baseline = await read(join(output, 'node-baseline.json'));
assert.equal(baseline.version, pkg.version);
assert.equal(baseline.engineVersion, pkg.fullbleed.engineVersion);
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
await writeFile(join(output, 'bundle.log'), run([wrangler, 'deploy', '--dry-run', '--outdir', join(output, 'bundle')]));
const port = Number(process.env.FULLBLEED_CLOUDFLARE_STARTER_PORT ?? 9489);
assert(Number.isSafeInteger(port) && port > 1024 && port < 65536);
const base = `http://127.0.0.1:${port}`;
try { await fetch(base + '/health', { signal: AbortSignal.timeout(1000) }); throw new Error(`Test port ${port} is already in use.`); }
catch (error) { if (!error.cause && error.name !== 'TimeoutError' && !String(error).includes('fetch failed')) throw error; }
let log = '';
const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'],
  { cwd: consumer, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', data => { log += data.toString(); });
child.stderr.on('data', data => { log += data.toString(); });
let spawnError;
child.on('error', error => { spawnError = error; });
const record = { ok: false, packageVersion: pkg.version, engineVersion: pkg.fullbleed.engineVersion,
  tarballSha256: packed.tarballSha256, node: process.version, platform: process.platform,
  sourceSha256: createHash('sha256').update(await readFile(join(consumer, 'test/fixtures.mjs'))).digest('hex'),
  wrangler: (await read(join(root, 'node_modules/wrangler/package.json'))).version,
  workerd: (await read(join(root, 'node_modules/workerd/package.json'))).version,
  isolatedTarball: true, standaloneConfig: true, inputTests: 5,
  localOnly: true, hostedVerified: false, freePlanVerified: false };
try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('Wrangler exited during startup:\n' + log);
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ok === true) { ready = true; break; }
    } catch { /* Poll while the local runtime starts. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Wrangler did not become ready:\n' + log);
  const { checkWorker } = await import(pathToFileURL(join(consumer, 'test/worker.mjs')).href);
  const http = await checkWorker(base, output);
  for (const item of http.records) {
    const expected = baseline.records.find(value => value.name === (item.name === 'after-errors' ? 'sample' : item.name));
    assert.equal(item.pdf, expected.pdf, item.name + ' Node/Workers PDF bytes');
    assert(expected.pages >= item.minPages && expected.pages <= item.maxPages, item.name + ' page range');
    assert.equal(expected.missingGlyphs, 0);
    Object.assign(item, { pages: expected.pages, nodeBytesIdentical: true });
  }
  Object.assign(record, http);
} finally {
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (child.exitCode === null && child.signalCode === null) await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
  }
  record.serverStopped = child.exitCode !== null || child.signalCode !== null;
  await writeFile(join(output, 'wrangler.log'), log);
  await writeFile(join(output, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
  await writeFile(join(outputRoot, 'latest.json'), JSON.stringify({ output, ok: record.ok }, null, 2) + '\n');
}
assert(record.ok && record.serverStopped);
console.log(JSON.stringify({ ok: record.ok, records: record.records.length, errors: record.errors.length, output }));
