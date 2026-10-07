// SPDX-License-Identifier: MIT
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRenderQueue } from 'fullbleed';

const template = await readFile(new URL('./invoice.html', import.meta.url), 'utf8');
const css = await readFile(new URL('./invoice.css', import.meta.url), 'utf8');
const customers = ['Maple & Finch', 'Cedar Works', 'Fern Design', 'Juniper Press', 'Coast Studio', 'Pine & Paper'];
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const output = resolve(process.argv[2] ?? 'output/queued-invoices');
await mkdir(output, { recursive: true });
const documents = createRenderQueue({ concurrency: 2, maxQueue: 4 });
try {
  const results = await Promise.all(customers.map(async (customer, index) => {
    const reference = `NS-${1042 + index}`;
    const html = template.replaceAll('Maple &amp; Finch', escapeHtml(customer)).replaceAll('NS-1042', reference);
    const result = await documents.renderPdf({ html, css, previewDpi: index === 0 ? 96 : 0 });
    await writeFile(join(output, reference + '.pdf'), result.pdf);
    if (index === 0) await writeFile(join(output, reference + '.png'), result.previews[0]);
    return { reference, customer, pages: result.pages, missingGlyphs: result.missingGlyphs };
  }));
  console.log(JSON.stringify({ output, invoices: results }));
} finally {
  await documents.close();
}
