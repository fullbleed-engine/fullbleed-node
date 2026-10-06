// SPDX-License-Identifier: MIT
'use strict';
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { fork } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const pkg = require('../package.json');

const { FullbleedError, normalize } = require('./render-input.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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

function renderProcess(job, remaining) {
  return new Promise((resolve, reject) => {
    let child, timer, closed = false, failure, reply, exited, disconnected = false;
    const timeout = () => new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`);
    const cleanup = () => {
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', abort);
    };
    const stop = error => {
      if (closed || failure) return;
      failure = error;
      // Cancellation can occur synchronously inside fork instrumentation. Wait
      // until the returned process handle has been assigned before killing it.
      queueMicrotask(() => {
        if (!closed && child?.pid) child.kill('SIGKILL');
      });
    };
    const abort = () => stop(new FullbleedError('ABORTED', 'PDF rendering was aborted.'));
    timer = setTimeout(() => stop(timeout()), remaining);
    job.signal?.addEventListener('abort', abort, { once: true });
    if (job.signal?.aborted) {
      cleanup();
      reject(new FullbleedError('ABORTED', 'PDF rendering was aborted.'));
      return;
    }
    try {
      const env = { ...process.env };
      // The bundled child needs no application preloads, inspector, eval script,
      // or custom loader. Avoid replaying them in a fresh application process.
      for (const key of Object.keys(env)) if (key.toUpperCase() === 'NODE_OPTIONS') delete env[key];
      child = fork(join(__dirname, 'process-worker.cjs'), [], {
        execPath: process.execPath, execArgv: [], env,
        serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
      child.on('error', cause => stop(new FullbleedError('PROCESS_FAILED', 'The rendering process failed.', { cause })));
      child.on('message', message => {
        if (reply || message?.type !== 'result' || typeof message.ok !== 'boolean') {
          stop(new FullbleedError('PROCESS_FAILED', 'The rendering process returned an invalid response.'));
          return;
        }
        const result = message.result;
        if (message.ok
          ? !(result?.pdf instanceof Uint8Array) || Buffer.from(result.pdf.subarray(0, 5)).toString() !== '%PDF-'
            || !Number.isSafeInteger(result.pages) || result.pages < 1 || result.pages > job.maxPages
            || !Array.isArray(result.previews) || result.previews.length !== (job.previewDpi ? result.pages : 0)
            || !Array.from(result.previews).every(bytes => bytes instanceof Uint8Array
              && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            || !Number.isSafeInteger(result.missingGlyphs) || result.missingGlyphs < 0
            || result.engineVersion !== pkg.fullbleed.engineVersion
          : typeof message.code !== 'string' || typeof message.message !== 'string') {
          stop(new FullbleedError('PROCESS_FAILED', 'The rendering process returned an invalid result.'));
          return;
        }
        reply = message;
      });
      const finish = (code, signal) => {
        if (closed) return;
        closed = true;
        cleanup();
        // Receiving PDF bytes is insufficient: a native crash during shutdown
        // must reject the request, even if its result was sent before the crash.
        if (!failure && (code !== 0 || signal || !reply)) {
          failure = new FullbleedError('PROCESS_FAILED',
            `Rendering process exited without completing successfully (code ${code}, signal ${signal ?? 'none'}).`);
        }
        if (failure) {
          if (failure.code === 'PROCESS_FAILED') {
            failure.exitCode = code;
            failure.signal = signal;
          }
          reject(failure);
        } else if (!reply.ok) {
          reject(new FullbleedError(reply.code, reply.message));
        } else {
          const result = reply.result;
          resolve({ pdf: Buffer.from(result.pdf), previews: result.previews.map(bytes => Buffer.from(bytes)),
            pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: result.engineVersion });
        }
      };
      // All stdio is ignored except IPC. Waiting for both exit and disconnect
      // drains messages and proves the process has stopped. On Windows, an
      // interrupted IPC write can omit 'close' even after both these events.
      child.once('exit', (code, signal) => {
        exited = { code, signal };
        if (disconnected) finish(code, signal);
      });
      child.once('disconnect', () => {
        disconnected = true;
        if (exited) finish(exited.code, exited.signal);
      });
      // A spawn error emits close without exit.
      child.once('close', finish);
      if (failure || job.signal?.aborted) {
        if (!failure) abort();
        return;
      }
      child.send({ type: 'render', options: {
        html: job.html, css: job.css, fonts: job.customFonts.map(font => font.data),
        assets: Object.fromEntries(job.assetFiles.map(file => [file.name.slice('assets/'.length), file.data])),
        previewDpi: job.previewDpi, maxPages: job.maxPages, allowMissingGlyphs: job.allowMissingGlyphs,
        timeoutMs: remaining,
      } }, error => {
        if (error) stop(new FullbleedError('PROCESS_FAILED', 'Could not send the rendering request.', { cause: error }));
      });
    } catch (cause) {
      if (child) {
        stop(new FullbleedError('PROCESS_FAILED', 'Could not start the rendering request.', { cause }));
      } else {
        closed = true;
        cleanup();
        reject(new FullbleedError('PROCESS_FAILED', 'Could not start the rendering process.', { cause }));
      }
    }
  });
}

async function renderPdf(options) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new FullbleedError('UNSUPPORTED_NODE', 'Fullbleed requires Node.js 22 or newer.');
  const start = Date.now();
  const job = normalize(options);
  const aborted = () => new FullbleedError('ABORTED', 'PDF rendering was aborted.');
  if (job.signal?.aborted) throw aborted();
  const remaining = job.timeoutMs - (Date.now() - start);
  if (remaining <= 0) throw new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`);
  if (job.isolation === 'process') return renderProcess(job, remaining);
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', abort);
      // A process 'worker' listener can abort synchronously inside the Worker
      // constructor. Let that constructor assign its handle before cleanup.
      await Promise.resolve();
      try {
        await worker?.terminate();
      } catch (cause) {
        reject(new FullbleedError('WORKER_FAILED', 'Could not stop the rendering worker.', { cause }));
        return;
      }
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
          html: job.html, css: 'body { font-family: Inter; }\n' + job.css, previewDpi: job.previewDpi, maxPages: job.maxPages,
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
