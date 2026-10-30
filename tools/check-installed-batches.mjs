// SPDX-License-Identifier: MIT
// Copied into the isolated tarball consumer by verify-pack.mjs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { renderPdfBatch, createRenderQueue, version, engineVersion } from 'fullbleed';
import { batchFixtures } from './batch-fixtures.mjs';

const out = process.argv[2];
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const cjs = require('fullbleed');
const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
const fixtures = [];
try {
  for (const fixture of batchFixtures) {
    const fonts = await Promise.all((fixture.fontFiles ?? []).map(name => readFile(new URL('./fonts/' + name, import.meta.url))));
    const options = { ...fixture.options, fonts };
    const result = await renderPdfBatch(options);
    assert.equal(result.engineVersion, engineVersion);
    assert.equal(result.pages, fixture.pages);
    assert.equal(result.missingGlyphs, fixture.missingGlyphs);
    assert.deepEqual(result.records.map(row => row.pageCount), fixture.recordPages);
    assert.deepEqual(result.records.map(row => row.missingGlyphs.map(({ codepoint, count }) => ({ codepoint, count }))), fixture.missingRows);
    assert.deepEqual(await cjs.renderPdfBatch({ ...options, isolation: 'process' }), result);
    assert.deepEqual(await queue.renderPdfBatch(options), result);
    await writeFile(join(out, fixture.name + '.pdf'), result.pdf);
    for (const [i, png] of result.previews.entries()) await writeFile(join(out, `${fixture.name}-${i + 1}.png`), png);
    fixtures.push({ name: fixture.name, pages: result.pages, missingGlyphs: result.missingGlyphs, records: result.records,
      pdf: hash(result.pdf), previews: result.previews.map(hash), cjsProcessAndQueueEqual: true });
  }
} finally { await queue.close(); }

const readme = await readFile(join(dirname(require.resolve('fullbleed')), '../README.md'), 'utf8');
const section = readme.split('## Generate a batch from one template')[1]?.split('\n## ')[0];
assert(section, 'The installed README must include batch authoring.');
const examples = [...section.matchAll(/```javascript\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
assert.equal(examples.length, 2);
const readmeExamples = [];
for (const [index, code] of examples.entries()) {
  const name = 'readme-batch-' + (index + 1);
  const expectedPages = index === 0 ? 2 : 1;
  const script = name + '.mjs';
  const report = join(out, name + '.json');
  const suffix = `\nimport _batchAssert from 'node:assert/strict';
import { writeFile as _batchWrite } from 'node:fs/promises';
import { createHash as _batchHash } from 'node:crypto';
_batchAssert.equal(result.pages, ${expectedPages});
_batchAssert.equal(result.records.length, ${expectedPages});
_batchAssert.equal(result.missingGlyphs, 0);
_batchAssert.equal(result.engineVersion, ${JSON.stringify(engineVersion)});
await _batchWrite(${JSON.stringify(join(out, name + '.pdf'))}, result.pdf);
await _batchWrite(${JSON.stringify(report)}, JSON.stringify({pages:result.pages,records:result.records,pdf:_batchHash('sha256').update(result.pdf).digest('hex')},null,2)+'\\n');
`;
  await writeFile(script, code + suffix);
  await writeFile(join(out, script), code + suffix);
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60000 });
  await writeFile(join(out, name + '.log'), run.stdout + run.stderr);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  readmeExamples.push({ name, unmodifiedExampleSha256: hash(code), ...JSON.parse(await readFile(report, 'utf8')) });
}
const record = { ok: true, packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  fixtures, readmeExamples, queueClosed: queue.closed,
  scope: 'Seven installed batch fixtures through ESM workers, CommonJS processes and the shared queue; both actual README examples executed.' };
await writeFile(join(out, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, fixtures: fixtures.length, readmeExamples: readmeExamples.length }));
