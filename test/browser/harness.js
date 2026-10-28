// SPDX-License-Identifier: MIT
import * as api from './fullbleed/client.js';
import { renderDocument, Paragraph, toHtml } from './ui/ui.js';
import { jsx } from './ui/jsx-runtime.js';
import { componentCases } from './components/cases.mjs';
import { Invoice } from './components/invoice-tsx.js';
import { Invoice as FunctionsInvoice } from './components/document.mjs';

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
const componentData = await (await fetch('./components/data.json')).json();
const components = new Map(componentCases(componentData, Invoice).map(({ name, node }) => [name, node]));
if (toHtml(jsx(Paragraph, { children: Paragraph('Shared identity') })) !== '<p><p>Shared identity</p></p>')
  throw new Error('Browser UI and JSX node identity differs');
if (toHtml(Invoice({ data: componentData })) !== toHtml(FunctionsInvoice({ data: componentData })))
  throw new Error('Browser TSX differs from function components');
const results = new Map();
const renderer = api.createRenderer({ assetBaseUrl: new URL('./fullbleed/', location.href) });
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
async function input(name) {
  const { fontFiles = [], fontNames = [], assetTexts = {}, ...options } = inputs[name];
  return { ...options,
    fonts: await Promise.all(fontFiles.map(async (file, i) => {
      const data = new Uint8Array(await (await fetch('./fixtures/' + file)).arrayBuffer());
      return fontNames[i] ? { name: fontNames[i], data } : data;
    })),
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
    const pending = components.has(name) ? renderDocument(components.get(name), renderer, { defaultStyles: false, previewDpi: 96 })
      : renderer.renderPdf(options);
    if (snapshot) {
      options.fonts.forEach(font => (font instanceof Uint8Array ? font : font.data).fill(0));
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
  async editComponent(customer) {
    const node = Invoice({ data: { ...componentData, customer } });
    const result = await renderDocument(node, renderer, { defaultStyles: false, previewDpi: 96 });
    results.set('component-edited', result);
    return { pages: result.pages, missingGlyphs: result.missingGlyphs, pdf: await hash(result.pdf), previews: await Promise.all(result.previews.map(hash)) };
  },
};

let previewUrl;
document.querySelector('#component-render').addEventListener('click', async () => {
  const button = document.querySelector('#component-render'), status = document.querySelector('#component-status');
  button.disabled = true; status.textContent = 'Rendering…';
  try {
    await globalThis.harness.editComponent(document.querySelector('#component-customer').value);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([results.get('component-edited').previews[0]], { type: 'image/png' }));
    document.querySelector('#component-preview').src = previewUrl;
    document.querySelector('#component-download').disabled = false;
    status.textContent = 'PDF ready';
  } catch (error) { status.textContent = error.message; throw error; }
  finally { button.disabled = false; }
});
document.querySelector('#component-download').addEventListener('click', () => globalThis.harness.download('component-edited'));
document.querySelector('#component-render').disabled = false;
document.documentElement.dataset.harnessReady = 'true';
