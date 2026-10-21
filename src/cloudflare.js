// SPDX-License-Identifier: MIT
import module from '../dist/engine.wasm';
import inter from '../assets/fonts/Inter-Variable.ttf';
import serif from '../assets/fonts/DMSerifDisplay-Regular.ttf';
import serifItalic from '../assets/fonts/DMSerifDisplay-Italic.ttf';
import display from '../assets/fonts/BebasNeue-Regular.ttf';
import input from './render-input.cjs';
import { runEngineSync } from './engine-runner.js';

export const version = __FULLBLEED_PACKAGE_VERSION__;
export const engineVersion = __FULLBLEED_ENGINE_VERSION__;
export const FullbleedError = input.FullbleedError;

const bundledFonts = [
  ['Inter-Variable.ttf', inter], ['DMSerifDisplay-Regular.ttf', serif],
  ['DMSerifDisplay-Italic.ttf', serifItalic], ['BebasNeue-Regular.ttf', display],
].map(([name, bytes]) => ({ name: 'fonts/' + name, data: new Uint8Array(bytes) }));

if (!(module instanceof WebAssembly.Module) || !WebAssembly.Module.imports(module)
  .every(item => item.module === 'wasi_snapshot_preview1' && !item.name.startsWith('sock_'))) {
  throw new FullbleedError('ENGINE_LOAD_FAILED', 'Bundle fullbleed/cloudflare with the engine as a compiled Wasm module.');
}

/** Render inside the current Worker isolate. CPU deadlines are platform-owned. */
export async function renderPdf(options) {
  const job = input.normalize(options, { browser: true, interruptible: false,
    maxSourceBytes: 1_000_000, maxAssetBytes: 8 * 1024 * 1024, defaultMaxPages: 20 });
  // Deliberately no await before or during the render: another request must not
  // acquire a second live engine instance while this call is executing.
  const result = runEngineSync({ module, html: job.html, css: input.stylesheet(job),
    fonts: [...bundledFonts, ...job.customFonts], assets: job.assetFiles,
    previewDpi: job.previewDpi, maxPages: job.maxPages, allowMissingGlyphs: job.allowMissingGlyphs });
  if (!result.ok) throw new FullbleedError(result.code, result.message);
  if (!(result.pdf instanceof Uint8Array) || !Number.isSafeInteger(result.pages) || result.pages < 1
    || result.pages > job.maxPages || !Number.isSafeInteger(result.missingGlyphs) || result.missingGlyphs < 0
    || !Array.isArray(result.previews) || result.previews.length !== (job.previewDpi ? result.pages : 0)
    || !result.previews.every(bytes => bytes instanceof Uint8Array &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))) {
    throw new FullbleedError('RENDER_FAILED', 'The rendering engine returned an invalid result.');
  }
  return { pdf: result.pdf, previews: result.previews, pages: result.pages,
    missingGlyphs: result.missingGlyphs, engineVersion };
}
