// SPDX-License-Identifier: MIT
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderPdf } from 'fullbleed';

const customer = 'Maple & Finch';
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const html = (await readFile(new URL('./invoice.html', import.meta.url), 'utf8'))
  .replace('Maple &amp; Finch', escapeHtml(customer));
const css = await readFile(new URL('./invoice.css', import.meta.url), 'utf8');
const result = await renderPdf({ html, css, previewDpi: 96 });
const output = resolve(process.argv[2] ?? 'output/invoice');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'invoice.pdf'), result.pdf);
for (let i = 0; i < result.previews.length; i++) await writeFile(join(output, `page-${i + 1}.png`), result.previews[i]);
console.log(JSON.stringify({ pdf: join(output, 'invoice.pdf'), pages: result.pages, missingGlyphs: result.missingGlyphs, engine: result.engineVersion }));
