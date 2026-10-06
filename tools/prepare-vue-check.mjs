// SPDX-License-Identifier: MIT
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const app = path.resolve('examples/vue');
const out = path.resolve('output/vue-baseline');
await mkdir(out, { recursive: true });
const require = createRequire(path.join(app, 'package.json'));
const { renderPdf } = require('fullbleed');
const records = [];
for (const design of ['invoice', 'report']) {
  const html = (await readFile(path.join(app, 'src', design + '.html'), 'utf8'))
    .replaceAll('{{customer}}', 'Maple &amp; Finch').replaceAll('{{reference}}', 'NS-1042');
  const css = (await readFile(path.join(app, 'src', design + '.css'), 'utf8')).replaceAll('{{ink}}', '#17382e');
  const result = await renderPdf({ html, css, previewDpi: 96, maxPages: 20, timeoutMs: 30_000 });
  await writeFile(path.join(out, design + '.pdf'), result.pdf);
  for (const [index, bytes] of result.previews.entries()) await writeFile(path.join(out, `${design}-${index + 1}.png`), bytes);
  records.push({ design, pages: result.pages, pdfSha256: createHash('sha256').update(result.pdf).digest('hex'),
    previews: result.previews.map(bytes => createHash('sha256').update(bytes).digest('hex')) });
}
const installed = JSON.parse(await readFile(path.join(app, 'node_modules/fullbleed/package.json'), 'utf8'));
await writeFile(path.join(out, 'verification.json'), JSON.stringify({ package: installed.version,
  engine: installed.fullbleed.engineVersion, node: process.version, records }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, out, records }));
