import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const [installedRoot, sourceRoot, outputRoot] = process.argv.slice(2).map(p => resolve(p));
assert(installedRoot && sourceRoot && outputRoot);
mkdirSync(outputRoot, { recursive: false });
const require = createRequire(join(installedRoot, 'package.json'));
const { renderPdf, version, engineVersion } = require('fullbleed');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => appendFileSync(join(outputRoot, 'progress.jsonl'), JSON.stringify(value) + '\n');
const active = new Set();
let peak = 0, created = 0, completed = 0;
process.on('worker', worker => {
  created++;
  active.add(worker);
  peak = Math.max(peak, active.size);
  worker.once('exit', () => active.delete(worker));
});
const fixtures = ['invoice', 'report'].flatMap(name => [0, 96].map(previewDpi => ({
  name: `${name}-${previewDpi}`,
  pages: name === 'invoice' ? 1 : 3,
  html: readFileSync(join(sourceRoot, `examples/${name}.html`), 'utf8'),
  css: readFileSync(join(sourceRoot, `examples/${name}.css`), 'utf8'),
  previewDpi,
})));
writeFileSync(join(outputRoot, 'runtime.json'), JSON.stringify({
  version, engineVersion, node: process.version, v8: process.versions.v8,
  flags: process.execArgv, rounds: 20, concurrency: fixtures.length,
  platform: process.platform, arch: process.arch,
  scriptSha256: hash(readFileSync(process.argv[1])),
}, null, 2) + '\n');
const expected = new Map();
async function run(fixture, round) {
  const { name, pages, ...options } = fixture;
  record({ phase: 'start', name, round, active: active.size, created });
  const result = await renderPdf({ ...options, timeoutMs: 60000 });
  assert.equal(result.pages, pages);
  assert.equal(result.missingGlyphs, 0);
  assert.equal(result.previews.length, options.previewDpi ? pages : 0);
  const digest = { pdf: hash(result.pdf), previews: result.previews.map(hash) };
  if (round === 0) {
    expected.set(name, digest);
    writeFileSync(join(outputRoot, name + '.pdf'), result.pdf);
    result.previews.forEach((png, i) => writeFileSync(join(outputRoot, `${name}-${i + 1}.png`), png));
  } else assert.deepEqual(digest, expected.get(name));
  completed++;
  record({ phase: 'result', name, round, ...digest, active: active.size, created });
}
for (const fixture of fixtures) await run(fixture, 0);
for (let round = 1; round <= 20; round++) {
  const results = await Promise.allSettled(fixtures.map(fixture => run(fixture, round)));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason));
  assert.equal(active.size, 0);
}
assert.equal(created, 84);
assert.equal(completed, 84);
assert(peak >= 2 && peak <= 4);
record({ phase: 'complete', completed, created, peak, active: active.size });
console.log(JSON.stringify({ completed, created, peak, active: active.size }));
