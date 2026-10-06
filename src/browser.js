// SPDX-License-Identifier: MIT
import input from './render-input.cjs';

export const version = __FULLBLEED_PACKAGE_VERSION__;
export const engineVersion = __FULLBLEED_ENGINE_VERSION__;
export const FullbleedError = input.FullbleedError;
const invalid = message => { throw new FullbleedError('INVALID_INPUT', message); };

/** Create a browser renderer using the assets copied to your site's static directory. */
export function createRenderer(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Pass an assetBaseUrl pointing to your hosted Fullbleed assets.');
  for (const key of Object.keys(options)) if (key !== 'assetBaseUrl') invalid(`Unknown renderer option: ${key}`);
  if (typeof globalThis.Worker !== 'function' || !globalThis.location || !globalThis.crypto?.subtle || !globalThis.WebAssembly) {
    throw new FullbleedError('UNSUPPORTED_BROWSER', 'Use a browser with Web Workers, WebAssembly and Web Crypto over HTTPS or localhost.');
  }
  if (typeof options.assetBaseUrl !== 'string' && !(options.assetBaseUrl instanceof URL)) invalid('assetBaseUrl must be a URL or URL string.');
  let base;
  try { base = new URL(options.assetBaseUrl, globalThis.location.href); }
  catch { invalid('assetBaseUrl is not a valid URL.'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== globalThis.location.origin || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
    invalid('assetBaseUrl must be a same-origin HTTP(S) directory URL ending in /, without credentials, a query or a fragment.');
  }
  const entry = new URL('worker.js', base);
  entry.searchParams.set('v', version);

  async function renderPdf(options) {
    const start = Date.now();
    const job = input.normalize(options, { browser: true });
    const aborted = () => new FullbleedError('ABORTED', 'PDF rendering was aborted.');
    if (job.signal?.aborted) throw aborted();
    const remaining = job.timeoutMs - (Date.now() - start);
    if (remaining <= 0) throw new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`);
    return new Promise((resolve, reject) => {
      let worker, timer, settled = false, ready = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        job.signal?.removeEventListener('abort', abort);
        // A caller may synchronously abort while a Worker constructor is being
        // instrumented. Let its handle be assigned before requesting termination.
        queueMicrotask(() => {
          try { worker?.terminate(); }
          catch (cause) { reject(new FullbleedError('WORKER_FAILED', 'Could not stop the render worker.', { cause })); return; }
          if (error) reject(error); else resolve(result);
        });
      };
      const abort = () => finish(aborted());
      timer = setTimeout(() => finish(new FullbleedError('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`)), remaining);
      job.signal?.addEventListener('abort', abort, { once: true });
      if (job.signal?.aborted) { abort(); return; }
      try {
        worker = new Worker(entry.href, { type: 'module', name: 'Fullbleed PDF renderer', credentials: 'omit' });
        worker.addEventListener('error', event => {
          event.preventDefault();
          finish(new FullbleedError('WORKER_FAILED', 'The rendering worker could not run. Check the copied assets and the site content security policy.'));
        });
        worker.addEventListener('messageerror', () => finish(new FullbleedError('WORKER_FAILED', 'The rendering worker returned an unreadable response.')));
        worker.addEventListener('message', ({ data }) => {
          if (settled) return;
          if (!ready) {
            if (data?.type !== 'ready' || data.protocol !== 1 || data.version !== version || data.engineVersion !== engineVersion) {
              finish(new FullbleedError('VERSION_MISMATCH', 'The hosted browser assets do not match this package. Copy the assets again and deploy them together.'));
              return;
            }
            ready = true;
            try {
              worker.postMessage({ type: 'render', job: {
                html: job.html, css: 'body { font-family: Inter; }\n' + job.css,
                fonts: job.customFonts, assets: job.assetFiles, previewDpi: job.previewDpi,
                maxPages: job.maxPages, allowMissingGlyphs: job.allowMissingGlyphs,
              } });
            } catch (cause) { finish(new FullbleedError('WORKER_FAILED', 'Could not send the document to the rendering worker.', { cause })); }
            return;
          }
          if (data?.type !== 'result' || typeof data.ok !== 'boolean') {
            finish(new FullbleedError('WORKER_FAILED', 'The rendering worker returned an invalid response.'));
            return;
          }
          if (!data.ok) {
            finish(typeof data.code === 'string' && typeof data.message === 'string'
              ? new FullbleedError(data.code, data.message)
              : new FullbleedError('WORKER_FAILED', 'The rendering worker returned an invalid error.'));
            return;
          }
          if (!(data.pdf instanceof Uint8Array) || new TextDecoder().decode(data.pdf.subarray(0, 5)) !== '%PDF-'
            || !Number.isSafeInteger(data.pages) || data.pages < 1 || data.pages > job.maxPages
            || !Array.isArray(data.previews) || data.previews.length !== (job.previewDpi ? data.pages : 0)
            || !data.previews.every(bytes => bytes instanceof Uint8Array && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
            || !Number.isSafeInteger(data.missingGlyphs) || data.missingGlyphs < 0 || data.engineVersion !== engineVersion) {
            finish(new FullbleedError('WORKER_FAILED', 'The rendering worker returned an invalid result.'));
            return;
          }
          finish(null, { pdf: data.pdf, previews: data.previews, pages: data.pages, missingGlyphs: data.missingGlyphs, engineVersion });
        });
        if (job.signal?.aborted) abort();
      } catch (cause) {
        finish(new FullbleedError('WORKER_FAILED', 'Could not start the rendering worker.', { cause }));
      }
    });
  }
  return Object.freeze({ renderPdf });
}
