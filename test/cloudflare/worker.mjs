import { renderPdf, renderPdfBatch, FullbleedError, version, engineVersion } from 'fullbleed/cloudflare';
import customFont from './custom-font.ttf';
import mathFont from './math-font.ttf';
import { optionsFor, errorOptions } from './cases.mjs';

// The installed adapter must use static assets and a synchronous instance path.
globalThis.fetch = () => { throw new Error('SDK rendering must not fetch assets or document URLs.'); };
for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
  WebAssembly[name] = () => { throw new Error('Use the statically bundled compiled module.'); };
}
const OriginalInstance = WebAssembly.Instance;
let synchronous = false, instances = 0, outsideSynchronousCall = 0;
WebAssembly.Instance = function(...args) {
  instances++;
  if (!synchronous) outsideSynchronousCall++;
  return Reflect.construct(OriginalInstance, args);
};
const render = options => {
  synchronous = true;
  try { return (options.records ? renderPdfBatch : renderPdf)(options); }
  finally { synchronous = false; }
};
const base64 = bytes => {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
};
const encode = result => ({ ...result, pdf: base64(result.pdf), previews: result.previews.map(base64) });

export default {
  async fetch(request) {
    if (new URL(request.url).pathname === '/health') return Response.json({ version, engineVersion, instances, outsideSynchronousCall });
    try {
      const { name, error, burst, allowMissingGlyphs } = await request.json();
      const font = new Uint8Array(customFont);
      if (burst) {
        const results = await Promise.all([render(optionsFor('invoice', font)), render(optionsFor('report', font)),
          render(optionsFor('batch-reflow', font, new Uint8Array(mathFont)))]);
        return Response.json({ results: results.map(encode), outsideSynchronousCall, instances });
      }
      const options = error ? errorOptions(name, font) : optionsFor(name, font, new Uint8Array(mathFont));
      if (allowMissingGlyphs) options.allowMissingGlyphs = true;
      const result = await render(options);
      return Response.json({ ...encode(result), outsideSynchronousCall, instances });
    } catch (error) {
      return Response.json({ code: error.code, message: error.message, fullbleedError: error instanceof FullbleedError,
        outsideSynchronousCall, instances }, { status: error instanceof FullbleedError ? 422 : 500 });
    }
  },
};
