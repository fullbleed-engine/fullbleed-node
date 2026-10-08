// Diagnostic-only instrumentation; never imported by the published package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [installedArg, sourceArg, outputArg, roundsArg = '20'] = process.argv.slice(2);
assert(installedArg && sourceArg && outputArg);
const installedRoot = resolve(installedArg), sourceRoot = resolve(sourceArg), outputRoot = resolve(outputArg);
const rounds = Number(roundsArg);
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20);
mkdirSync(outputRoot, { recursive: false });
const hash = value => createHash('sha256').update(value).digest('hex');
const record = value => appendFileSync(join(outputRoot, 'progress.jsonl'), JSON.stringify(value) + '\n');
const require = createRequire(join(installedRoot, 'package.json'));
const threads = require('node:worker_threads');
const NativeWorker = threads.Worker;
const wasiUrl = pathToFileURL(require.resolve('@bjorn3/browser_wasi_shim')).href;
const controllers = new Map();
const active = new Set();
let created = 0, peak = 0, markers = 0, aborted = 0, completed = 0;

// This observer wraps the log collector, not a WebAssembly import function.
// Victims pause inside the existing fd_write host call. The dedicated channel
// avoids interfering with Fullbleed's result protocol on parentPort.
function instrumentVictim(wasiUrl) {
  return `
    (async () => {
      const { workerData } = require('node:worker_threads');
      const { port, gate, id } = workerData.__fullbleedDiagnostic;
      const flags = new Int32Array(gate);
      const { ConsoleStdout } = await import(${JSON.stringify(wasiUrl)});
      const original = ConsoleStdout.lineBuffered;
      let notified = false;
      ConsoleStdout.lineBuffered = function(collect) {
        return original.call(this, line => {
          collect(line);
          if (!notified && line.includes('[fullbleed][assets]') && line.includes('<style>')) {
            notified = true;
            const stack = new Error('in-Wasm diagnostic observation').stack;
            Atomics.store(flags, 0, 1);
            port.postMessage({ id, line, stack });
            // Bounded: a missing parent cancellation fails instead of hanging.
            const waitResult = Atomics.wait(flags, 0, 1, 10000);
            throw new Error('Victim host callback resumed before termination: ' + waitResult);
          }
        });
      };
  `;
}

threads.Worker = class DiagnosticWorker extends NativeWorker {
  constructor(source, options) {
    assert.equal(options.eval, true);
    const match = options.workerData.html.match(/fullbleed-diagnostic-victim:([a-z0-9-]+)/);
    if (!match) {
      super(source, options);
      return;
    }
    const id = match[1], controller = controllers.get(id);
    assert(controller, 'Victim must have a registered abort controller.');
    const { port1, port2 } = new threads.MessageChannel();
    const gate = new SharedArrayBuffer(4);
    super(instrumentVictim(wasiUrl) + `await ${source}; })();`, {
      ...options,
      workerData: { ...options.workerData, __fullbleedDiagnostic: { id, gate, port: port2 } },
      transferList: [...(options.transferList || []), port2],
    });
    port1.on('message', message => {
      try {
        assert.equal(message.id, id);
        assert.match(message.stack, /wasm-function|wasm:\/\/wasm/);
        assert.equal(Atomics.load(new Int32Array(gate), 0), 1);
        markers++;
        record({ phase: 'in-wasm-abort', id, active: active.size, ...message });
        controller.abort();
      } catch (error) {
        record({ phase: 'observer-error', id, error: error.stack });
        controller.abort(error);
        process.exitCode = 1;
      }
    });
    this.once('exit', () => port1.close());
  }
};

process.on('worker', worker => {
  created++;
  active.add(worker);
  peak = Math.max(peak, active.size);
  worker.once('exit', () => active.delete(worker));
});
const { renderPdf, version, engineVersion } = require('fullbleed');
const fixtures = ['invoice', 'report'].flatMap(name => [0, 96].map(previewDpi => ({
  name: `${name}-${previewDpi}`,
  pages: name === 'invoice' ? 1 : 3,
  html: readFileSync(join(sourceRoot, `examples/${name}.html`), 'utf8'),
  css: readFileSync(join(sourceRoot, `examples/${name}.css`), 'utf8'),
  previewDpi,
})));
writeFileSync(join(outputRoot, 'runtime.json'), JSON.stringify({
  version, engineVersion, node: process.version, v8: process.versions.v8,
  flags: process.execArgv, rounds, platform: process.platform, arch: process.arch,
  scriptSha256: hash(readFileSync(process.argv[1])),
  fixtures: fixtures.map(f => ({ name: f.name, htmlSha256: hash(f.html), cssSha256: hash(f.css) })),
  instrumentation: 'Victims pause in a log-collector callback called from Wasm fd_write; parent aborts after observing its Wasm stack through a dedicated MessagePort. Package files and Wasm import functions are unchanged; timing is deliberately altered.',
}, null, 2) + '\n');
const expected = new Map();
async function survivor(fixture, round) {
  const { name, pages, ...options } = fixture;
  record({ phase: 'start', name, round, role: 'survivor', active: active.size });
  const result = await renderPdf({ ...options, timeoutMs: 60000 });
  assert.equal(result.pages, pages);
  assert.equal(result.missingGlyphs, 0);
  assert.equal(result.previews.length, options.previewDpi ? pages : 0);
  const digest = { pdf: hash(result.pdf), previews: result.previews.map(hash) };
  if (round === 0) {
    expected.set(name, digest);
    writeFileSync(join(outputRoot, `${name}.pdf`), result.pdf);
    result.previews.forEach((png, i) => writeFileSync(join(outputRoot, `${name}-${i + 1}.png`), png));
  } else assert.deepEqual(digest, expected.get(name));
  completed++;
  record({ phase: 'result', name, round, ...digest, active: active.size });
}
async function victim(round, position) {
  const id = `r${round}-v${position}`, controller = new AbortController();
  controllers.set(id, controller);
  record({ phase: 'start', id, role: 'victim', active: active.size });
  try {
    await assert.rejects(renderPdf({
      html: `<html><head><style></style></head><body><!-- fullbleed-diagnostic-victim:${id} --><p>synthetic cancellation probe</p></body></html>`,
      signal: controller.signal, timeoutMs: 60000,
    }), error => error.code === 'ABORTED');
    assert(controller.signal.aborted, 'Victim did not receive the observed active abort.');
    assert.equal(controller.signal.reason?.name, 'AbortError');
    aborted++;
    record({ phase: 'aborted', id, active: active.size });
  } finally { controllers.delete(id); }
}
try {
  for (const fixture of fixtures) await survivor(fixture, 0);
  for (let round = 1; round <= rounds; round++) {
    const offset = round % 2;
    const results = await Promise.allSettled([
      survivor(fixtures[offset], round),
      survivor(fixtures[2 + offset], round),
      victim(round, 1), victim(round, 2),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason));
    assert.equal(active.size, 0);
    assert.equal(markers, round * 2);
    assert.equal(aborted, round * 2);
  }
  assert.equal(created, 4 + rounds * 4);
  assert.equal(completed, 4 + rounds * 2);
  assert.equal(peak, 4);
  assert(!process.exitCode);
  const result = { phase: 'complete', rounds, completed, aborted, markers, created, peak, active: active.size };
  record(result);
  writeFileSync(join(outputRoot, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  record({ phase: 'failed', error: error.stack, causes: error.errors?.map(e => e.stack) });
  throw error;
} finally { threads.Worker = NativeWorker; }
