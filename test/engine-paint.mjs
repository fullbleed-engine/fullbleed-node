// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';

export const enginePaintSource = JSON.parse(await readFile(new URL('./fixtures/engine-paint-2.5.28.json', import.meta.url), 'utf8'));
export const enginePaintFixtures = enginePaintSource.cases.map(({ name, pages, html, css, previewDpi, defaultStyles }) =>
  ({ name, pages, html, css, previewDpi, defaultStyles }));
