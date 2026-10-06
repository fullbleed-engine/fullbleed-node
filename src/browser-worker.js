// SPDX-License-Identifier: MIT
import { runEngine } from './engine-runner.js';

const version = __FULLBLEED_PACKAGE_VERSION__;
const engineVersion = __FULLBLEED_ENGINE_VERSION__;
const files = __FULLBLEED_RUNTIME_FILES__;
const fontNames = __FULLBLEED_FONT_NAMES__;
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

async function load(name) {
  const url = new URL(name, self.location.href);
  url.searchParams.set('v', version);
  const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== files[name].bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== files[name].sha256) {
    throw new Error(`Bundled asset failed verification: ${name}.`);
  }
  return bytes;
}

self.addEventListener('message', async ({ data }) => {
  let result;
  try {
    if (data?.type !== 'render') throw new Error('Invalid render request.');
    const [wasm, ...fontBytes] = await Promise.all([load('engine.wasm'), ...fontNames.map(name => load('fonts/' + name))]);
    const module = await WebAssembly.compile(wasm);
    if (!WebAssembly.Module.imports(module).every(item => item.module === 'wasi_snapshot_preview1' && !item.name.startsWith('sock_'))) {
      throw new Error('Unexpected WebAssembly host imports.');
    }
    result = await runEngine({ ...data.job, module,
      fonts: [...fontNames.map((name, i) => ({ name: 'fonts/' + name, data: fontBytes[i] })), ...data.job.fonts] });
  } catch (cause) {
    result = { ok: false, code: 'ENGINE_LOAD_FAILED', message: 'Could not load the bundled Fullbleed engine: ' + cause.message };
  }
  self.postMessage({ type: 'result', engineVersion, ...result }, result.ok ? [result.pdf.buffer, ...result.previews.map(page => page.buffer)] : []);
  self.close();
}, { once: true });
self.postMessage({ type: 'ready', protocol: 1, version, engineVersion });
