import { renderPdf, version, engineVersion } from 'fullbleed';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { caseNames, expected, optionsFor } from './cases.mjs';
const output = process.argv[2];
const font = new Uint8Array(await readFile(new URL('./custom-font.ttf', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const name of caseNames) {
  const options = optionsFor(name, font);
  const result = await renderPdf(options);
  if (result.pages !== expected[name].pages || result.missingGlyphs !== 0) throw new Error('Invalid baseline: ' + name);
  await writeFile(join(output, name + '-node.pdf'), result.pdf);
  for (const [i, bytes] of result.previews.entries()) await writeFile(join(output, `${name}-node-${i + 1}.png`), bytes);
  records.push({ name, ...expected[name], pdf: hash(result.pdf), previews: result.previews.map(hash), missingGlyphs: result.missingGlyphs });
}
await writeFile(join(output, 'node-baseline.json'), JSON.stringify({ ok: true, version, engineVersion, records }, null, 2) + '\n');
