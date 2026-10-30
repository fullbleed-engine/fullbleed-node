// SPDX-License-Identifier: MIT
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { renderPdf, createRenderQueue, FullbleedError, version, engineVersion } from 'fullbleed';

const fixture = JSON.parse(await readFile(new URL('./fixtures/default-styles.json', import.meta.url), 'utf8'));
// Retain the original reference version and hashes across the engine upgrade.
assert.equal(fixture.engineVersion, '2.5.43');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
const out = process.env.FULLBLEED_STYLE_EVIDENCE;
async function verify(name, result, expected) {
  assert.equal(result.engineVersion, engineVersion);
  assert.equal(result.pages, 1);
  assert.equal(result.missingGlyphs, 0);
  assert.equal(result.previews.length, 1);
  assert.equal(hash(result.pdf), expected.pdf, name + ': PDF');
  assert.equal(hash(result.previews[0]), expected.png, name + ': preview');
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, name + '.pdf'), result.pdf);
    await writeFile(join(out, name + '.png'), result.previews[0]);
  }
  records.push({ name, pdf: expected.pdf, png: expected.png });
}

for (const isolation of ['worker', 'process']) {
  for (const { name, html, css, previewDpi, engine, legacy } of fixture.cases) {
    test(`${isolation}: ${name} preserves original styles and legacy defaults`, async () => {
      const options = { html, css, previewDpi, isolation };
      await verify(`${isolation}-${name}-unchanged`, await renderPdf({ ...options, defaultStyles: false }), engine);
      await verify(`${isolation}-${name}-default`, await renderPdf(options), legacy);
      await verify(`${isolation}-${name}-explicit`, await renderPdf({ ...options, defaultStyles: true }), legacy);
    });
  }
  test(`${isolation}: queues snapshot the defaultStyles choice at admission`, async t => {
    const queue = createRenderQueue({ concurrency: 1, maxQueue: 5 });
    t.after(() => queue.close());
    const jobs = fixture.cases.map(({ html, css, previewDpi }) => {
      const options = { html, css, previewDpi, isolation, defaultStyles: false };
      const pending = queue.renderPdf(options);
      options.defaultStyles = true;
      return pending;
    });
    assert.equal(queue.pendingCount, 5);
    const results = await Promise.all(jobs);
    for (const [i, result] of results.entries()) {
      const { name, engine } = fixture.cases[i];
      await verify(`queue-${isolation}-${name}`, result, engine);
    }
  });
  test(`${isolation}: nonboolean style options reject on direct and queued calls`, async t => {
    const queue = createRenderQueue();
    t.after(() => queue.close());
    for (const defaultStyles of [null, 0, 1, 'false', {}, []]) {
      const options = { html: 'Invalid style choice', isolation, defaultStyles };
      const invalid = error => error instanceof FullbleedError && error.code === 'INVALID_INPUT' && /defaultStyles/.test(error.message);
      await assert.rejects(renderPdf(options), invalid);
      await assert.rejects(queue.renderPdf(options), invalid);
    }
  });
}
after(async () => {
  if (!out) return;
  const record = { ok: records.length === fixture.cases.length * 8, packageVersion: version, engineVersion,
    node: process.version, platform: process.platform, fixtures: fixture.cases.length,
    baseline: fixture.baseline, baselineEngineVersion: fixture.engineVersion,
    sourceSha256: hash(await readFile(new URL('./fixtures/default-styles.json', import.meta.url))), records };
  await writeFile(join(out, 'verification.json'), JSON.stringify(record, null, 2) + '\n');
});
