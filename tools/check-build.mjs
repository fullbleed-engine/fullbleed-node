// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('dist/build.json', root), 'utf8'));
assert.equal(manifest.packageVersion, pkg.version);
assert.equal(manifest.engineVersion, pkg.fullbleed.engineVersion);
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
}
assert.deepEqual(await readFile(new URL('src/index.d.ts', root)), await readFile(new URL('dist/index.d.cts', root)));
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
