// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../src/render-input.cjs';

const invalid = callback => assert.throws(callback, error => error.code === 'INVALID_INPUT');
test('named fonts snapshot names and bytes and share the font/asset budget', () => {
  const font = { name: 'Café Brand.ttf', data: new Uint8Array([1, 2, 3]) };
  const job = normalize({ html: 'x', fonts: [font] });
  font.name = 'Other.ttf'; font.data.fill(9);
  assert.equal(job.customFonts[0].name, 'fonts/named/Café Brand.ttf');
  assert.deepEqual(job.customFonts[0].data, new Uint8Array([1, 2, 3]));
  invalid(() => normalize({ html: 'x', fonts: [font], assets: { image: new Uint8Array(2) } }, { maxAssetBytes: 4 }));
  assert.equal(normalize({ html: 'x', fonts: [new Uint8Array([1])] }).customFonts[0].name, 'fonts/custom-0.ttf');
});
test('unsafe, ambiguous and malformed font inputs are rejected before rendering', () => {
  const data = new Uint8Array([1]);
  for (const name of ['', '../x.ttf', 'fonts/x.ttf', 'x\\y.ttf', 'x:stream.ttf', 'CON.ttf', 'name.ttf ', 'bad\n.ttf', 'image.png', 'x'.repeat(121) + '.ttf']) {
    invalid(() => normalize({ html: 'x', fonts: [{ name, data }] }));
  }
  for (const font of [null, {}, { name: 'a.ttf' }, { name: 'a.ttf', data: 'bytes' }, { name: 'a.ttf', data, family: 'Ignored' }]) {
    invalid(() => normalize({ html: 'x', fonts: [font] }));
  }
  for (const fonts of [[{ name: 'a.ttf', data }, { name: 'A.TTF', data }],
    [{ name: 'café.ttf', data }, { name: 'cafe\u0301.ttf', data }], [data, { name: 'custom-0.ttf', data }]]) {
    invalid(() => normalize({ html: 'x', fonts }));
  }
});
