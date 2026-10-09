// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';

export const engineRegressionSource = JSON.parse(await readFile(new URL('./fixtures/engine-2.5.22.json', import.meta.url), 'utf8'));
export const engineRegressionFixtures = engineRegressionSource.cases.map(({ name, pages, html, css, previewDpi, fontFiles = [] }) =>
  ({ name, pages, html, css, previewDpi, fontFiles }));

export async function loadEngineRegressionFixtures() {
  return Promise.all(engineRegressionFixtures.map(async ({ fontFiles, ...fixture }) => ({ ...fixture,
    fonts: await Promise.all(fontFiles.map(name => readFile(new URL('./fonts/' + name, import.meta.url)))),
  })));
}
