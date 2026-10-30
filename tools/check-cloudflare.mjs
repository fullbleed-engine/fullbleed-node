// SPDX-License-Identifier: MIT
// Exercise the isolated npm tarball with Wrangler's real local workerd runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const pkg = await read(join(root, 'package.json'));
const packed = await read(join(root, 'output/pack-verification/verification.json'));
assert(packed.ok && packed.package === `fullbleed-${pkg.version}.tgz`, 'Verify the final tarball first.');
const install = join(root, 'output/pack-verification', packed.installDirectory);
const consumer = await mkdtemp(join(install, 'cloudflare consumer '));
const outputRoot = join(root, 'output/cloudflare-verification');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const port = Number(process.env.FULLBLEED_CLOUDFLARE_TEST_PORT ?? 9488);
assert(Number.isSafeInteger(port) && port > 1024 && port < 65536);
const base = `http://127.0.0.1:${port}`;
try { await fetch(base + '/health', { signal: AbortSignal.timeout(1000) }); throw new Error(`Test port ${port} is already in use.`); }
catch (error) { if (!error.cause && error.name !== 'TimeoutError' && !String(error).includes('fetch failed')) throw error; }

for (const name of ['worker.mjs', 'cases.mjs', 'baseline.mjs']) {
  await copyFile(join(root, 'test/cloudflare', name), join(consumer, name));
}
await copyFile(join(root, 'test/batch-fixtures.mjs'), join(consumer, '../batch-fixtures.mjs'));
await copyFile(join(root, 'test/fonts/NotoSansMath-Regular.ttf'), join(consumer, 'math-font.ttf'));
await copyFile(join(root, 'test/fonts/NotoSansMath-OFL.txt'), join(consumer, 'math-font-OFL.txt'));
await copyFile(join(root, 'test/fonts/family/LibreCaslonText[wght].ttf'), join(consumer, 'custom-font.ttf'));
await copyFile(join(root, 'test/fonts/family/OFL.txt'), join(consumer, 'custom-font-OFL.txt'));
const raw = {};
for (const name of ['invoice', 'report']) {
  const fill = text => text.replaceAll('{{reference}}', 'NS-1042').replaceAll('{{customer}}', 'Cedar &amp; Co.').replaceAll('{{ink}}', '#183e2d');
  raw[name] = { html: fill(await readFile(join(root, `examples/browser/src/${name}.html`), 'utf8')),
    css: fill(await readFile(join(root, `examples/browser/src/${name}.css`), 'utf8')) };
}
await writeFile(join(consumer, 'raw.json'), JSON.stringify(raw));
const config = { name: 'fullbleed-package-check', main: 'worker.mjs', compatibility_date: '2026-10-20',
  send_metrics: false, workers_dev: false, preview_urls: false,
  rules: [{ type: 'Data', globs: ['**/*.ttf'], fallthrough: false }] };
await writeFile(join(consumer, 'wrangler.json'), JSON.stringify(config, null, 2));
const env = { ...process.env, PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? ''),
  WRANGLER_SEND_METRICS: 'false' };
const baselineRun = spawnSync(process.execPath, ['baseline.mjs', output], { cwd: consumer, env, encoding: 'utf8', timeout: 120000 });
assert.equal(baselineRun.status, 0, baselineRun.stderr || baselineRun.stdout);
const baseline = await read(join(output, 'node-baseline.json'));
assert.equal(baseline.version, pkg.version);
assert.equal(baseline.engineVersion, pkg.fullbleed.engineVersion);
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const dry = spawnSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', join(output, 'bundle')],
  { cwd: consumer, env, encoding: 'utf8', timeout: 60000 });
await writeFile(join(output, 'bundle.log'), dry.stdout + dry.stderr);
assert.equal(dry.status, 0, dry.stderr || dry.stdout);
let log = '';
const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
  '--inspector-port', '0'], { cwd: consumer, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', bytes => { log += bytes.toString(); });
child.stderr.on('data', bytes => { log += bytes.toString(); });
let spawnError;
child.on('error', error => { spawnError = error; });
const record = { ok: false, packageVersion: pkg.version, engineVersion: pkg.fullbleed.engineVersion,
  tarballSha256: packed.tarballSha256, node: process.version, platform: process.platform,
  sourceSha256: hash(await readFile(join(root, 'test/cloudflare/cases.mjs'))),
  wrangler: (await read(join(root, 'node_modules/wrangler/package.json'))).version,
  workerd: (await read(join(root, 'node_modules/workerd/package.json'))).version,
  localOnly: true, hostedVerified: false, freePlanVerified: false, records: [], errors: [] };
async function post(payload) {
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  assert.equal(data.outsideSynchronousCall, 0, 'Engine instantiation escaped the synchronous render call.');
  return { status: response.status, data };
}
async function checkResult(data, expected, suffix) {
  assert.equal(data.engineVersion, pkg.fullbleed.engineVersion);
  assert.equal(data.pages, expected.pages);
  assert.equal(data.missingGlyphs, expected.missingGlyphs);
  if (expected.records) assert.deepEqual(data.records, expected.records, expected.name + ' record reports');
  const pdf = Buffer.from(data.pdf, 'base64');
  assert.equal(hash(pdf), expected.pdf, expected.name + ' PDF bytes');
  assert.equal(data.previews.length, expected.previews.length);
  await writeFile(join(output, `${expected.name}-${suffix}.pdf`), pdf);
  for (const [i, encoded] of data.previews.entries()) {
    const png = Buffer.from(encoded, 'base64');
    assert.equal(hash(png), expected.previews[i], expected.name + ' preview bytes');
    await writeFile(join(output, `${expected.name}-${suffix}-${i + 1}.png`), png);
  }
  record.records.push({ ...expected, output: `${expected.name}-${suffix}.pdf`,
    previewFiles: data.previews.map((_, i) => `${expected.name}-${suffix}-${i + 1}.png`), nodeBytesIdentical: true });
}
try {
  const deadline = Date.now() + 60000;
  let health;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('Wrangler exited during startup:\n' + log);
    try { health = await (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert(health, 'Wrangler did not become ready:\n' + log);
  assert.equal(health.version, pkg.version);
  assert.equal(health.engineVersion, pkg.fullbleed.engineVersion);
  for (const expected of baseline.records) {
    const { status, data } = await post({ name: expected.name });
    assert.equal(status, 200, JSON.stringify(data));
    await checkResult(data, expected, 'workerd');
  }
  assert.equal(baseline.records.find(item => item.name === 'components').pdf,
    baseline.records.find(item => item.name === 'components-inline').pdf, 'Styled and separate HTML/CSS component exports must agree.');
  const errors = { timeout: 'INVALID_INPUT', signal: 'INVALID_INPUT', isolation: 'INVALID_INPUT',
    'source-limit': 'INVALID_INPUT', 'asset-limit': 'INVALID_INPUT', 'asset-path': 'INVALID_INPUT',
    'asset-collision': 'INVALID_INPUT', pages: 'PAGE_LIMIT', 'default-pages': 'PAGE_LIMIT', glyph: 'MISSING_GLYPHS',
    'batch-source-limit': 'INVALID_INPUT', 'batch-fields': 'INVALID_INPUT', 'batch-bindings': 'INVALID_BINDINGS',
    'batch-pages': 'PAGE_LIMIT', 'batch-glyph': 'MISSING_GLYPHS' };
  for (const [name, code] of Object.entries(errors)) {
    const { status, data } = await post({ name, error: true });
    assert.equal(status, 422, JSON.stringify(data));
    assert.equal(data.code, code, name);
    assert.equal(data.fullbleedError, true);
    record.errors.push({ name, code });
  }
  const allowed = await post({ name: 'glyph', error: true, allowMissingGlyphs: true });
  assert.equal(allowed.status, 200);
  assert(allowed.data.missingGlyphs > 0, 'Explicitly allowed missing glyphs must remain diagnosed.');
  record.allowedMissingGlyphs = allowed.data.missingGlyphs;
  const burstResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ burst: true }), signal: AbortSignal.timeout(60000) });
  assert.equal(burstResponse.status, 200);
  const burst = await burstResponse.json();
  assert.equal(burst.outsideSynchronousCall, 0);
  for (const [i, name] of ['invoice', 'report', 'batch-reflow'].entries()) {
    await checkResult(burst.results[i], baseline.records.find(item => item.name === name), 'after-errors');
  }
  record.synchronousInstantiation = true;
  record.noRuntimeFetchingOrCompilation = true;
  record.recovery = true;
  record.ok = true;
} finally {
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  if (child.exitCode === null && child.signalCode === null && child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  record.serverStopped = child.exitCode !== null || child.signalCode !== null;
  await writeFile(join(output, 'wrangler.log'), log);
  await writeFile(join(output, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
  await writeFile(join(outputRoot, 'latest.json'), JSON.stringify({ output, ok: record.ok }, null, 2) + '\n');
}
assert(record.serverStopped, 'The test runtime must stop.');
console.log(JSON.stringify({ ok: record.ok, packageVersion: record.packageVersion, records: record.records.length,
  errors: record.errors.length, recovery: record.recovery, output }));
