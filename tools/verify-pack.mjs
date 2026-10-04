// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output/pack-verification');
await mkdir(output, { recursive: true });
const cache = await mkdtemp(join(output, 'fresh npm cache '));
assert(process.env.npm_execpath, 'Run this check with npm run verify:pack');
function npm(args, cwd) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, env: { ...process.env, npm_config_cache: cache }, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--package-dir'), 'Use --package-dir DIRECTORY or no arguments.');
const packageDirectory = args.length ? resolve(args[1]) : output;
const packed = args.length ? JSON.parse(await readFile(join(packageDirectory, 'package-info.json'), 'utf8'))
  : JSON.parse(npm(['pack', '--json', '--pack-destination', output], root))[0];
if (!args.length) await writeFile(join(output, 'package-info.json'), JSON.stringify(packed, null, 2) + '\n');
const names = packed.files.map(f => f.path);
for (const required of ['dist/engine.wasm', 'dist/build.json', 'dist/index.d.cts', 'dist/THIRD_PARTY_NOTICES.txt', 'src/index.js', 'src/index.cjs', 'src/index.d.ts', 'src/worker.js', 'LICENSE', 'README.md', 'package.json']) assert(names.includes(required), required);
assert(names.every(n => /^(?:dist\/|src\/|assets\/fonts\/|LICENSE$|README\.md$|package\.json$)/.test(n)), names);
assert(!names.some(n => /(?:\.env|node_modules|target|test\/|engine\/)/.test(n)), names);
const tarball = join(packageDirectory, packed.filename);
assert.equal('sha512-' + createHash('sha512').update(await readFile(tarball)).digest('base64'), packed.integrity);
const first = await mkdtemp(join(output, 'fresh consumer with spaces '));
await writeFile(join(first, 'package.json'), JSON.stringify({ name: 'fullbleed-install-check', version: '0.0.0', private: true, type: 'module' }));
npm(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', tarball], first);
const install = await mkdtemp(join(output, 'offline consumer with spaces '));
for (const name of ['package.json', 'package-lock.json']) await copyFile(join(first, name), join(install, name));
npm(['ci', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], install);
const tree = JSON.parse(npm(['ls', '--all', '--json'], install));
assert.deepEqual(Object.keys(tree.dependencies), ['fullbleed']);
assert.deepEqual(Object.keys(tree.dependencies.fullbleed.dependencies), ['@bjorn3/browser_wasi_shim']);
assert(!tree.dependencies.fullbleed.dependencies['@bjorn3/browser_wasi_shim'].dependencies);
for (const name of names) assert.deepEqual(await readFile(join(install, 'node_modules/fullbleed', name)), await readFile(join(root, name)), name + ': installed bytes differ from verified source/build');
const script = `
import assert from 'node:assert/strict';
import { renderPdf, FullbleedError, engineVersion } from 'fullbleed';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const input = {html:'<h1>Installed package</h1><p>Invoice NS-1042</p>', previewDpi:96};
const activeWorkers = new Set();
let createdWorkers = 0;
process.on('worker', worker => {
  createdWorkers++;
  activeWorkers.add(worker);
  worker.once('exit', () => activeWorkers.delete(worker));
});
// Exercise a cold cancellation before engine compilation has completed.
await assert.rejects(renderPdf({...input,timeoutMs:1}), e => e instanceof FullbleedError && e.code==='TIMEOUT');
const result=await renderPdf(input);
assert.equal(activeWorkers.size,0,'The installed rendering worker must exit before success.');
assert.equal(result.pages,1); assert.equal(result.missingGlyphs,0);
assert.equal(result.pdf.subarray(0,5).toString(),'%PDF-');
const cjs=createRequire(import.meta.url)('fullbleed');
assert.equal(hash((await cjs.renderPdf(input)).pdf),hash(result.pdf));
assert.equal(activeWorkers.size,0,'The CommonJS worker must also exit before success.');
assert(createdWorkers>=2,'Observe actual rendering workers.');
await writeFile('installed.pdf',result.pdf);
await writeFile('installed.png',result.previews[0]);
console.log(JSON.stringify({ok:true,engine:engineVersion,pdf:hash(result.pdf),png:hash(result.previews[0]),cjs:true,coldTimeoutRecovered:true,settledWorkersReleased:true}));
`;
await writeFile(join(install, 'smoke.mjs'), script);
const env = { ...process.env, PATH: dirname(process.execPath) };
const run = spawnSync(process.execPath, ['smoke.mjs'], { cwd: install, env, encoding: 'utf8', timeout: 60000 });
assert.equal(run.status, 0, run.stderr);
const smoke = JSON.parse(run.stdout);
const inline = spawnSync(process.execPath, ['--stack-trace-limit=10', '--input-type=module', '--eval', "import {renderPdf} from 'fullbleed'; console.log((await renderPdf({html:'Inline module works'})).pages)"], { cwd: install, env, encoding: 'utf8', timeout: 60000 });
assert.equal(inline.status, 0, inline.stderr);
assert.equal(inline.stdout.trim(), '1');
const report = { ok: true, node: process.version, platform: process.platform, package: packed.filename,
  tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), files: names,
  freshCacheInstall: true, offlineInstallFromGeneratedLock: true, runtimePath: 'Node executable directory only', installDirectory: install.slice(output.length + 1),
  inlineModule: true, smoke };
await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
