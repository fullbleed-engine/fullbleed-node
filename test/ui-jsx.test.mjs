// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { toHtml, Document, Paragraph, createElement } from 'fullbleed/ui';
import { jsx, jsxs, Fragment } from 'fullbleed/ui/jsx-runtime';
import { jsxDEV } from 'fullbleed/ui/jsx-dev-runtime';
import { Invoice, money } from '../examples/components/document.mjs';

test('JSX runtimes share ESM/CommonJS identity and reject async/nested documents', () => {
  for (const runtime of [jsx, jsxs, jsxDEV, createRequire(import.meta.url)('fullbleed/ui/jsx-runtime').jsx,
    createRequire(import.meta.url)('fullbleed/ui/jsx-dev-runtime').jsxDEV]) {
    assert.equal(toHtml(runtime(Fragment, { children: [runtime(Paragraph, { children: 'JSX' }), Paragraph('Functions')] })),
      '<p>JSX</p><p>Functions</p>');
    const doc = runtime(Document, { title: 'JSX', children: Paragraph('Hello') });
    assert.equal(doc.toHtml(), Document({ title: 'JSX' }, Paragraph('Hello')).toHtml());
    assert.throws(() => runtime(Paragraph, { children: doc }), /outer document/);
    assert.throws(() => runtime(async () => 'Async', {}), /component child/);
    assert.throws(() => runtime('p', { onClick() {} }), /scalar/);
    assert.throws(() => runtime('p', { ref: {} }), /refs/);
    assert.equal(toHtml(runtime(({ key, children }) => { assert.equal(key, undefined); return children; },
      { key: 'ignored', children: 'Static' }, 'also-ignored')), 'Static');
  }
  assert.equal(toHtml(createElement(Paragraph, { className: 'text' }, 'A', 'B')), '<p class="text">AB</p>');
  assert.throws(() => createElement(Paragraph, { children: 'A' }, 'B'), /props.children/);
});

test('real JSX production, development and CommonJS compilation match function authoring', async () => {
  const data = JSON.parse(await readFile(new URL('../examples/components/data.json', import.meta.url), 'utf8'));
  const output = resolve('output/ui-runtime');
  await mkdir(output, { recursive: true });
  for (const [format, jsxDev, suffix] of [['esm', false, 'mjs'], ['esm', true, 'dev.mjs'], ['cjs', false, 'cjs']]) {
    const outfile = `${output}/invoice.${suffix}`;
    await build({ entryPoints: ['examples/components/invoice.tsx'], outfile, bundle: true, packages: 'external',
      platform: 'node', format, jsx: 'automatic', jsxDev, logLevel: 'silent' });
    const compiled = await import(pathToFileURL(outfile).href);
    for (const record of [data, { ...data, paid: true }, { ...data, items: [] },
      { ...data, customer: '<script>&"' }, { ...data, items: [{ ...data.items[0], rate_cents: -150 }] }]) {
      assert.equal(compiled.Invoice({ data: record }).toHtml(), Invoice({ data: record }).toHtml());
      assert.equal(compiled.Invoice({ data: record }).toCss(), Invoice({ data: record }).toCss());
    }
  }
  assert.equal(money(-150), '-$1.50');
  assert.equal(money(0), '$0.00');
  assert.throws(() => money(1.5), /integer cents/);
});

test('compiler key-after-spread fallback uses the same createElement implementation', async () => {
  const outfile = resolve('output/ui-runtime/key-fallback.mjs');
  await mkdir(resolve('output/ui-runtime'), { recursive: true });
  const source = '/** @jsxImportSource fullbleed/ui */\nimport { Paragraph } from "fullbleed/ui"; const props = { className: "item" }; export const result = <Paragraph {...props} key="last">Fallback</Paragraph>;';
  await build({ stdin: { contents: source, loader: 'tsx', resolveDir: resolve('.') }, outfile,
    jsx: 'automatic', platform: 'node', format: 'esm', bundle: true, packages: 'external', logLevel: 'silent' });
  const emitted = await readFile(outfile, 'utf8');
  assert.match(emitted, /createElement/);
  assert.equal(toHtml((await import(pathToFileURL(outfile).href)).result), '<p class="item">Fallback</p>');
});
