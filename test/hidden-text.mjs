// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';

export const hiddenTextSource = JSON.parse(await readFile(new URL('./fixtures/hidden-text-2.5.24.json', import.meta.url), 'utf8'));
export const hiddenTextFixtures = hiddenTextSource.cases.flatMap(({ name, sourceHtml, controlHtml, css, previewDpi, pages }) =>
  [['source', sourceHtml], ['control', controlHtml]].map(([variant, html]) => ({
    name: `visibility-${name}-${variant}`, html, css, previewDpi, pages, defaultStyles: false,
  })));
