// SPDX-License-Identifier: MIT
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderPdf } from 'fullbleed';
import { Invoice } from './document.mjs';


export async function writeInvoice(invoice, destination = 'output/components') {
  const html = invoice.toHtml(), css = invoice.toCss();
  const result = await invoice.renderPdf(renderPdf, { defaultStyles: false, previewDpi: 96 });
  const replay = await invoice.renderPdf(renderPdf, { defaultStyles: false });
  if (!result.pdf.equals(replay.pdf)) throw new Error('Repeated render changed');
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'invoice.html'), html);
  await writeFile(join(output, 'invoice.css'), css);
  await writeFile(join(output, 'invoice.pdf'), result.pdf);
  for (const [index, page] of result.previews.entries()) await writeFile(join(output, `page-${index + 1}.png`), page);
  const report = { ok: true, engine: result.engineVersion, pages: result.pages, missingGlyphs: result.missingGlyphs,
    pdf_sha256: createHash('sha256').update(result.pdf).digest('hex'), repeated_pdf_equal: true };
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(resolve(process.argv[1])).href) {
  const data = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
  await writeInvoice(Invoice({ data }), process.argv[2]);
}
