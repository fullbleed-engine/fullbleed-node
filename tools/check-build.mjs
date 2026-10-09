// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('dist/build.json', root), 'utf8'));
assert.equal(manifest.packageVersion, pkg.version);
assert.equal(manifest.engineVersion, pkg.fullbleed.engineVersion);
assert.deepEqual(manifest.engineFeatures, ['svg_raster']);
const notices = await readFile(new URL('dist/THIRD_PARTY_NOTICES.txt', root), 'utf8');
for (const family of ['Liberation', 'NotoSans', 'NotoSansMath', 'NotoSansSymbols', 'NotoSansSymbols2']) {
  const path = `dist/preview-font-notices/LICENSE-${family}.txt`;
  assert(manifest.files[path], `Preview font license is absent from the build manifest: ${path}`);
  assert(notices.includes(await readFile(new URL(path, root), 'utf8')), `Browser notices omit ${family}`);
}
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
}
assert.deepEqual(await readFile(new URL('src/index.d.ts', root)), await readFile(new URL('dist/index.d.cts', root)));
const browser = JSON.parse(await readFile(new URL('dist/browser/asset-manifest.json', root), 'utf8'));
assert.equal(browser.packageVersion, pkg.version);
assert.equal(browser.engineVersion, pkg.fullbleed.engineVersion);
assert.deepEqual(browser.engineFeatures, manifest.engineFeatures);
for (const record of Object.values(browser.files)) {
  const bytes = await readFile(new URL(record.source, root));
  assert.equal(bytes.length, record.bytes, record.source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.source);
}
const wasm = await readFile(new URL('dist/engine.wasm', root));
let cursor = 8, memoryMaximum;
const leb = () => {
  let value = 0, shift = 0, byte;
  do { byte = wasm[cursor++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
  return value;
};
while (cursor < wasm.length) {
  const section = wasm[cursor++], length = leb(), end = cursor + length;
  if (section === 5) {
    assert.equal(leb(), 1);
    const flags = leb(); leb();
    assert.equal(flags, 1, 'Expected an unshared memory with an explicit maximum');
    memoryMaximum = leb() * 65536;
  }
  cursor = end;
}
assert.equal(memoryMaximum, manifest.memoryMaximumBytes);
assert.equal(memoryMaximum, 536870912);
const module = await WebAssembly.compile(wasm);
assert(WebAssembly.Module.imports(module).every(i => i.module === 'wasi_snapshot_preview1' && !i.name.startsWith('sock_')));
