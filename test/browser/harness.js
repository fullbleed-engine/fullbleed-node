// SPDX-License-Identifier: MIT
import * as api from './fullbleed/client.js';

const NativeWorker = globalThis.Worker;
const records = [];
globalThis.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args);
    this.record = { posts: 0, stops: 0 };
    records.push(this.record);
    globalThis.abortOnConstruct?.abort();
  }
  postMessage(...args) { this.record.posts++; return super.postMessage(...args); }
  terminate() { this.record.stops++; return super.terminate(); }
};
for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
  WebAssembly[name] = () => { throw new Error('WebAssembly must execute in the worker, not on the page.'); };
}
const inputs = await (await fetch('./fixtures/inputs.json')).json();
const results = new Map();
const renderer = api.createRenderer({ assetBaseUrl: new URL('./fullbleed/', location.href) });
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
async function input(name) {
  const { fontFiles = [], assetTexts = {}, ...options } = inputs[name];
  return { ...options,
    fonts: await Promise.all(fontFiles.map(async file => new Uint8Array(await (await fetch('./fixtures/' + file)).arrayBuffer()))),
    assets: Object.fromEntries(Object.entries(assetTexts).map(([name, text]) => [name, new TextEncoder().encode(text)])),
  };
}
const stats = () => ({ created: records.length, terminationCalls: records.reduce((sum, row) => sum + row.stops, 0),
  postedMessages: records.reduce((sum, row) => sum + row.posts, 0), allTerminatedOnce: records.every(row => row.stops === 1) });
async function capture(promise) {
  try { const value = await promise; return { ok: true, value }; }
  catch (error) { return { ok: false, code: error.code, message: error.message, fullbleedError: error instanceof api.FullbleedError }; }
}
globalThis.harness = {
  api, renderer, input, stats, capture,
  async render(name, snapshot = false) {
    const options = await input(name);
    const pending = renderer.renderPdf(options);
    if (snapshot) {
      options.fonts.forEach(bytes => bytes.fill(0));
      Object.values(options.assets).forEach(bytes => bytes.fill(0));
    }
    const result = await pending;
    results.set(name, result);
    return { pages: result.pages, missingGlyphs: result.missingGlyphs, engineVersion: result.engineVersion,
      pdf: await hash(result.pdf), previews: await Promise.all(result.previews.map(hash)),
      browserBytes: result.pdf instanceof Uint8Array && result.pdf.buffer instanceof ArrayBuffer, stats: stats() };
  },
  download(name, preview = -1) {
    const result = results.get(name);
    const url = URL.createObjectURL(new Blob([preview < 0 ? result.pdf : result.previews[preview]], { type: preview < 0 ? 'application/pdf' : 'image/png' }));
    const link = document.createElement('a');
    link.href = url; link.download = name + (preview < 0 ? '.pdf' : `-${preview + 1}.png`);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
