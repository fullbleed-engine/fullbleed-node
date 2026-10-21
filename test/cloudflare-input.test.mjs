import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const { normalize, FullbleedError } = createRequire(import.meta.url)('../src/render-input.cjs');
const limits = { browser: true, interruptible: false, maxSourceBytes: 1_000_000,
  maxAssetBytes: 8 * 1024 * 1024, defaultMaxPages: 20 };
const invalid = fn => assert.throws(fn, error => error instanceof FullbleedError && error.code === 'INVALID_INPUT');

test('Workers source budget counts UTF-8 bytes, including CSS', () => {
  assert.equal(normalize({ html: 'é'.repeat(500_000) }, limits).maxPages, 20);
  invalid(() => normalize({ html: 'é'.repeat(500_000), css: 'x' }, limits));
  assert.equal(normalize({ html: 'x'.repeat(1_000_001) }).maxPages, 1000);
});

test('Workers font and asset budget is combined and snapshots accepted bytes', () => {
  const font = new Uint8Array(4 * 1024 * 1024).fill(1);
  const asset = new Uint8Array(4 * 1024 * 1024).fill(2);
  const job = normalize({ html: 'x', fonts: [font], assets: { 'image.dat': asset } }, limits);
  font[0] = 3; asset[0] = 4;
  assert.equal(job.customFonts[0].data[0], 1);
  assert.equal(job.assetFiles[0].data[0], 2);
  invalid(() => normalize({ html: 'x', fonts: [font], assets: { a: asset, b: new Uint8Array([1]) } }, limits));
  assert.equal(normalize({ html: 'x', assets: { a: new Uint8Array(8 * 1024 * 1024 + 1) } }).assetFiles.length, 1);
});

test('Workers reject interrupt and isolation options instead of accepting ineffective controls', () => {
  for (const option of [{ timeoutMs: 1000 }, { signal: new AbortController().signal }, { isolation: 'worker' }]) {
    invalid(() => normalize({ html: 'x', ...option }, limits));
  }
  assert.equal(normalize({ html: 'x', timeoutMs: 10, isolation: 'process' }).timeoutMs, 10);
});
