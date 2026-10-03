// SPDX-License-Identifier: MIT
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderPdf, version } from 'fullbleed';
import { getDemoInvoice, invoiceTemplate } from '../lib/invoice.mjs';

const result = await renderPdf({ ...await invoiceTemplate(getDemoInvoice('NS-1042')), previewDpi: 96, maxPages: 5, timeoutMs: 15_000 });
if (result.pages !== 1 || result.missingGlyphs !== 0) throw new Error('Review the sample layout before publishing.');
await mkdir('public', { recursive: true });
await mkdir('output', { recursive: true });
await writeFile('public/invoice.png', result.previews[0]);
await writeFile('output/invoice.pdf', result.pdf);
const hash = value => createHash('sha256').update(value).digest('hex');
const record = { nodePackage: version, engineVersion: result.engineVersion, pages: result.pages, missingGlyphs: result.missingGlyphs, pdfSha256: hash(result.pdf), previewSha256: hash(result.previews[0]) };
await writeFile('output/preview.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
