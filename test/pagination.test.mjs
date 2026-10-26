// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdf } from 'fullbleed';
import { fixtures } from './pagination-fixtures.mjs';

for (const isolation of ['worker', 'process']) {
  test(`clipped auto-height content paginates in ${isolation} isolation`, async () => {
    for (const { name, kind, pages, html, css } of fixtures) {
      const result = await renderPdf({ html, css, defaultStyles: false, isolation });
      assert.equal(result.missingGlyphs, 0, name);
      if (kind === 'table') assert(result.pages > 2, name + ': long table did not continue');
      else assert.equal(result.pages, pages, name);
    }
  });
}
