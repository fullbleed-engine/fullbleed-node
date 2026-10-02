// SPDX-License-Identifier: MIT
'use strict';
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const pkg = require('../package.json');

class FullbleedError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'FullbleedError';
    this.code = code;
  }
}
const invalid = message => { throw new FullbleedError('INVALID_INPUT', message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceLimit = 4_000_000;
const assetLimit = 64 * 1024 * 1024;
const root = join(__dirname, '..');
let runtimePromise;

function runtime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const manifest = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8'));
    if (manifest.engineVersion !== pkg.fullbleed.engineVersion) throw new Error('Package and engine versions differ');
    async function verified(name) {
      const bytes = await readFile(join(root, name));
      const expected = manifest.files[name];
      if (!expected || expected.bytes !== bytes.length || expected.sha256 !== hash(bytes)) throw new Error(`Bundled file failed verification: ${name}`);
      return new Uint8Array(bytes);
    }
    const [wasm, fonts] = await Promise.all([
      verified('dist/engine.wasm'),
      Promise.all(manifest.fonts.map(async name => ({ name: 'fonts/' + name, data: await verified('assets/fonts/' + name) }))),
    ]);
    const module = await WebAssembly.compile(wasm);
    const imports = WebAssembly.Module.imports(module);
    if (!imports.every(i => i.module === 'wasi_snapshot_preview1' && !i.name.startsWith('sock_'))) throw new Error('Unexpected WebAssembly host imports');
    return { module, fonts };
  })().catch(cause => { throw new FullbleedError('ENGINE_LOAD_FAILED', 'Could not load the bundled Fullbleed engine: ' + cause.message, { cause }); });
  return runtimePromise;
}

function normalize(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Pass an options object with an html string.');
  const supported = new Set(['html', 'css', 'fonts', 'assets', 'previewDpi', 'timeoutMs', 'maxPages', 'allowMissingGlyphs', 'signal']);
  for (const key of Object.keys(options)) if (!supported.has(key)) invalid(`Unknown option: ${key}`);
  const { html, css = '', fonts = [], assets = {}, previewDpi = 0, timeoutMs = 30000, maxPages = 1000, allowMissingGlyphs = false, signal } = options;
  if (typeof html !== 'string' || !html.trim()) invalid('html must be a nonempty string.');
  if (typeof css !== 'string') invalid('css must be a string.');
  if (Buffer.byteLength(html) + Buffer.byteLength(css) > sourceLimit) invalid('HTML and CSS together must not exceed 4,000,000 UTF-8 bytes.');
  if (!Number.isInteger(previewDpi) || (previewDpi !== 0 && (previewDpi < 36 || previewDpi > 300))) invalid('previewDpi must be 0 (disabled) or an integer from 36 to 300.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) invalid('timeoutMs must be a positive integer no greater than 2147483647.');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) invalid('maxPages must be a positive integer.');
  if (typeof allowMissingGlyphs !== 'boolean') invalid('allowMissingGlyphs must be a boolean.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) invalid('signal must be an AbortSignal.');
  if (!Array.isArray(fonts)) invalid('fonts must be an array of font byte arrays.');
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) invalid('assets must map relative names to byte arrays.');
  let assetBytes = 0;
  function bytes(value, label) {
    if (!(value instanceof Uint8Array) || !value.byteLength) invalid(`${label} must be a nonempty Uint8Array or Buffer.`);
    assetBytes += value.byteLength;
    if (assetBytes > assetLimit) invalid('Custom fonts and assets together must not exceed 64 MiB.');
    return Uint8Array.from(value); // Snapshot caller-owned buffers before any await.
  }
  const customFonts = fonts.map((font, i) => ({ name: `fonts/custom-${i}.ttf`, data: bytes(font, `fonts[${i}]`) }));
  const names = Object.keys(assets);
  const fileNames = new Set(names);
  const assetFiles = names.map(name => {
    const segments = name.split('/');
    if (!name || /[\\:\0]/.test(name) || segments.some(s => !s || s === '.' || s === '..')) invalid(`Invalid asset path: ${name}`);
    for (let i = 1; i < segments.length; i++) if (fileNames.has(segments.slice(0, i).join('/'))) invalid(`Asset is both a file and a directory: ${name}`);
    return { name: 'assets/' + name, data: bytes(assets[name], `assets[${name}]`) };
  });
  return { html, css: 'body { font-family: Inter; }\n' + css, customFonts, assetFiles, previewDpi, timeoutMs, maxPages, allowMissingGlyphs, signal };
}

async function renderPdf(options) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new FullbleedError('UNSUPPORTED_NODE', 'Fullbleed requires Node.js 22 or newer.');
  const start = Date.now();
  const job = normalize(options);
  const aborted = () => new FullbleedError('ABORTED', 'PDF rendering was aborted.');
  if (job.signal?.aborted) throw aborted();
  const remaining = job.timeoutMs - (Date.now() - start);
  if (remaining <= 0) throw new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`);
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', abort);
      const termination = worker?.terminate();
      if (termination) termination.catch(() => {});
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(aborted());
    timer = setTimeout(() => finish(new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`)), remaining);
    job.signal?.addEventListener('abort', abort, { once: true });
    if (job.signal?.aborted) return abort();
    runtime().then(loaded => {
      if (settled) return;
      // A trusted inline bootstrap supports --input-type callers while letting
      // Node inherit process flags through its own worker compatibility rules.
      const entry = pathToFileURL(join(__dirname, 'worker.js')).href;
      worker = new Worker(`import(${JSON.stringify(entry)})`, {
        eval: true,
        workerData: {
          module: loaded.module, fonts: [...loaded.fonts, ...job.customFonts], assets: job.assetFiles,
          html: job.html, css: job.css, previewDpi: job.previewDpi, maxPages: job.maxPages,
          allowMissingGlyphs: job.allowMissingGlyphs,
        },
      });
      worker.once('error', cause => finish(new FullbleedError('WORKER_FAILED', cause.message, { cause })));
      worker.once('exit', code => {
        if (!settled) finish(new FullbleedError('WORKER_FAILED', `Rendering worker exited before producing a result (code ${code}).`));
      });
      worker.once('message', result => {
        if (!result.ok) return finish(new FullbleedError(result.code, result.message));
        finish(null, { pdf: Buffer.from(result.pdf), previews: result.previews.map(bytes => Buffer.from(bytes)),
          pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: pkg.fullbleed.engineVersion });
      });
      if (job.signal?.aborted) abort();
    }).catch(cause => finish(cause instanceof FullbleedError ? cause : new FullbleedError('WORKER_FAILED', cause.message, { cause })));
  });
}

exports.renderPdf = renderPdf;
exports.FullbleedError = FullbleedError;
exports.engineVersion = pkg.fullbleed.engineVersion;
exports.version = pkg.version;
