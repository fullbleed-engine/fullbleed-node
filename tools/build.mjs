// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildBrowser } from './build-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = join(root, 'engine');
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
function run(args, options = {}) {
  const result = spawnSync('cargo', args, { cwd: engine, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || 'Cargo build failed');
  return result.stdout;
}
run(['build', '--release', '--locked', '--target', 'wasm32-wasip1'], { stdio: 'inherit' });
const metadata = JSON.parse(run(['metadata', '--format-version', '1', '--locked']));
assert.equal(metadata.packages.find(p => p.name === 'fullbleed-node-adapter').version, pkg.version,
  'The npm package and Rust adapter versions must match');
const core = metadata.packages.find(p => p.name === 'fullbleed');
assert.equal(core.version, pkg.fullbleed.engineVersion);
assert(core.source?.startsWith('registry+'), 'Build from the published crate');
await mkdir(dist, { recursive: true });
await copyFile(join(root, 'src/index.d.ts'), join(dist, 'index.d.cts'));
await copyFile(join(engine, 'target/wasm32-wasip1/release/fullbleed-node-adapter.wasm'), join(dist, 'engine.wasm'));
const notices = [];
for (const dep of metadata.packages.filter(p => p.source)) {
  const folder = dirname(dep.manifest_path);
  const candidates = (await readdir(folder)).filter(name => /^LICEN[CS]E(?:$|[-_.])/i.test(name) || name === 'THIRD_PARTY_LICENSES.md');
  assert(candidates.length, `No notices found for ${dep.name}`);
  for (const name of candidates.sort()) {
    notices.push(`${dep.name} ${dep.version} / ${name}\n\n${await readFile(join(folder, name), 'utf8')}`);
  }
}
// These font programs are compiled into the engine's preview renderer. Retain
// their complete upstream notices as individual files and in the browser bundle.
const previewFontNotices = ['Liberation', 'NotoSans', 'NotoSansMath', 'NotoSansSymbols', 'NotoSansSymbols2']
  .map(name => `LICENSE-${name}.txt`);
await mkdir(join(dist, 'preview-font-notices'), { recursive: true });
for (const name of previewFontNotices) {
  const source = join(dirname(core.manifest_path), 'src/preview_fonts', name);
  await copyFile(source, join(dist, 'preview-font-notices', name));
  notices.push(`fullbleed ${core.version} / src/preview_fonts/${name}\n\n${await readFile(source, 'utf8')}`);
}
notices.push(`@bjorn3/browser_wasi_shim 0.4.2 / MIT\n\n${await readFile(join(root, 'node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT'), 'utf8')}`);
for (const name of (await readdir(join(root, 'assets/fonts'))).filter(n => n.endsWith('-OFL.txt')).sort()) {
  notices.push(`${name}\n\n${await readFile(join(root, 'assets/fonts', name), 'utf8')}`);
}
await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const name of ['dist/engine.wasm', 'dist/THIRD_PARTY_NOTICES.txt', ...previewFontNotices.map(name => 'dist/preview-font-notices/' + name), ...(await readdir(join(root, 'assets/fonts'))).sort().map(n => 'assets/fonts/' + n)]) {
  const bytes = await readFile(join(root, name));
  files[name] = { bytes: bytes.length, sha256: hash(bytes) };
}
const manifest = {
  packageVersion: pkg.version, engineVersion: core.version, engineSource: `https://crates.io/crates/fullbleed/${core.version}`,
  target: 'wasm32-wasip1', memoryMaximumBytes: 536870912,
  fonts: ['Inter-Variable.ttf', 'DMSerifDisplay-Regular.ttf', 'DMSerifDisplay-Italic.ttf', 'BebasNeue-Regular.ttf'],
  dependencies: metadata.packages.filter(p => p.source).map(p => ({ name: p.name, version: p.version, source: p.source, license: p.license })),
  files,
};
Object.assign(manifest.files, await buildBrowser(root, manifest));
await writeFile(join(dist, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, engine: core.version, wasm: files['dist/engine.wasm'] }));
