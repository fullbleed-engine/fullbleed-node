// SPDX-License-Identifier: MIT
// Exercise the production artifact with fictional data, outside the source tree.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { renderPdf, version, engineVersion } from 'fullbleed';
import { getDemoInvoice, invoiceTemplate } from '../lib/invoice.mjs';

const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, passed: true }); console.log(`${name}: passed`); };
const hash = data => createHash('sha256').update(data).digest('hex');
const project = process.cwd();
const folder = await mkdtemp(join(tmpdir(), 'fullbleed-nextjs-'));
await mkdir('output', { recursive: true });
await cp('.next/standalone', folder, { recursive: true, dereference: true });
await cp('public', join(folder, 'public'), { recursive: true });
await cp('.next/static', join(folder, '.next/static'), { recursive: true });
check('standalone artifact is isolated from the source application', !resolve(folder).startsWith(resolve(project)));
const manifest = JSON.parse(await readFile(join(folder, 'node_modules/fullbleed/dist/build.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(join(folder, 'node_modules/fullbleed', name));
  assert.equal(hash(bytes), expected.sha256, name);
}
check('standalone tracing retains the verified engine and all bundled fonts', manifest.engineVersion === engineVersion);

const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], { cwd: folder, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data.toString()).slice(-50000); });
const stopped = new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
stopped.catch(() => {});
const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await stopped; };
const get = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(25000) });
let serving = false;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Standalone server stopped.\n${logs}`);
    try { ready = (await get('/')).status === 200; } catch {}
    if (ready) break;
    await delay(250);
  }
  check('isolated production server starts on loopback', ready);
  const html = await (await get('/')).text();
  check('app exposes the sample download without a prefetched render', html.includes('Download sample PDF') && html.includes('href="/api/invoices/NS-1042"') && !html.includes('rel="prefetch"'));
  const image = await get('/invoice.png');
  check('standalone server includes the actual PDF preview asset', image.status === 200 && hash(Buffer.from(await image.arrayBuffer())) === hash(await readFile('public/invoice.png')));
  const expected = await renderPdf({ ...await invoiceTemplate(getDemoInvoice('NS-1042')), maxPages: 5, timeoutMs: 15000 });
  const url = '/api/invoices/NS-1042';
  async function pdfResponse(response) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="invoice-NS-1042.pdf"');
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(hash(bytes), hash(expected.pdf));
    return bytes;
  }
  const bytes = await pdfResponse(await get(url));
  await writeFile('output/route.pdf', bytes);
  check('production route returns complete private PDF bytes with a useful filename', true);
  const missing = await get('/api/invoices/NS-9999');
  check('unknown invoice IDs return a private JSON error', missing.status === 404 && /no-store/.test(missing.headers.get('cache-control')) && (await missing.json()).error.code === 'NOT_FOUND');
  check('unsupported writes are rejected by the route', (await get(url, { method: 'POST', body: '{}' })).status === 405);

  const burst = await Promise.all(Array.from({ length: 12 }, async () => {
    const response = await get(url);
    if (response.status === 200) { await pdfResponse(response); return 200; }
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.json()).error.code, 'BUSY');
    return 503;
  }));
  check('a concurrent burst receives explicit capacity errors instead of an unbounded queue', burst.includes(200) && burst.includes(503));
  await pdfResponse(await get(url));
  check('normal PDF downloads recover after a capacity burst', true);

  const templatePath = join(folder, 'templates/invoice.html');
  const original = await readFile(templatePath);
  try {
    await writeFile(templatePath, '<p>Integral: \u2a0c</p>');
    const failure = await get(url);
    const body = await failure.json();
    check('a real missing-glyph failure returns a generic non-PDF error', failure.status === 500 && body.error.code === 'RENDER_FAILED' && !JSON.stringify(body).includes('Integral'));
  } finally { await writeFile(templatePath, original); }
  await pdfResponse(await get(url));
  check('a valid document renders after an engine failure', true);
  try {
    await writeFile(templatePath, '<p style="break-after:page">Page limit sample</p>'.repeat(7));
    const failure = await get(url);
    check('the route enforces its page cap against a real multipage document', failure.status === 500 && (await failure.json()).error.code === 'RENDER_FAILED' && logs.includes('PAGE_LIMIT'));
  } finally { await writeFile(templatePath, original); }
  await pdfResponse(await get(url));
  check('a valid document renders after the page limit rejects a job', true);

  // Next can keep both the traced package and a renamed external-package copy.
  // Target every verified copy in this disposable artifact so the injected
  // failure reaches the package actually imported by the production route.
  async function processEntries(directory) {
    const found = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) found.push(...await processEntries(path));
      else if (entry.name === 'process-worker.cjs') found.push(path);
    }
    return found;
  }
  const processPaths = await processEntries(folder);
  assert(processPaths.length > 0, 'Standalone tracing must include the render child.');
  const originalProcessEntry = await readFile('node_modules/fullbleed/src/process-worker.cjs');
  for (const path of processPaths) assert.deepEqual(await readFile(path), originalProcessEntry);
  try {
    for (const path of processPaths) await writeFile(path, 'process.exit(23);\n');
    const failure = await get(url);
    check('a failed render child returns an HTTP error while the production server stays alive',
      failure.status === 500 && (await failure.json()).error.code === 'RENDER_FAILED'
      && logs.includes('PROCESS_FAILED') && child.exitCode === null);
  } finally { for (const path of processPaths) await writeFile(path, originalProcessEntry); }
  await pdfResponse(await get(url));
  check('the production server returns a valid PDF after a render-process failure', true);

  async function jsFiles(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await jsFiles(path));
      else if (entry.name.endsWith('.js')) result.push(path);
    }
    return result;
  }
  const chunks = await jsFiles(join(folder, '.next/static'));
  for (const file of chunks) assert.doesNotMatch(await readFile(file, 'utf8'), /browser_wasi_shim|engine\.wasm|node:worker_threads/);
  check('client JavaScript excludes the server PDF engine and worker', chunks.length > 0);
  const info = JSON.parse(await readFile('package.json', 'utf8'));
  const record = { checkedAt: new Date().toISOString(), node: process.version, platform: platform(), next: info.dependencies.next, nodePackage: version, engineVersion, isolation: 'process',
    packageLockSha256: hash(await readFile('package-lock.json')), base, standaloneFolder: folder, pages: expected.pages, pdfSha256: hash(bytes), burst, checks,
    scope: 'Real next build standalone server with released Fullbleed npm package and fictional data; HTTP recovery after deliberate child failure. No hosted platform or application-authentication claim.' };
  await writeFile('output/verification.json', JSON.stringify(record, null, 2) + '\n');
  await writeFile('output/server.log', logs);
  if (process.argv.includes('--serve')) {
    serving = true;
    console.log(`FULLBLEED_NEXT_PREVIEW_READY ${base}`);
    process.once('SIGINT', async () => { await stop(); process.exit(0); });
    process.once('SIGTERM', async () => { await stop(); process.exit(0); });
    await stopped;
  }
} catch (error) {
  await writeFile('output/failure.json', JSON.stringify({ error: error.stack, checks, base, standaloneFolder: folder }, null, 2) + '\n');
  await writeFile('output/server.log', logs);
  throw error;
} finally {
  if (!serving) await stop();
}
