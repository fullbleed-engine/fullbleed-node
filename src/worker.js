// SPDX-License-Identifier: MIT
import { parentPort, workerData } from 'node:worker_threads';
import { WASI, File, OpenFile, Directory, ConsoleStdout, PreopenDirectory } from '@bjorn3/browser_wasi_shim';

try {
  const job = workerData;
  const root = new PreopenDirectory('.', new Map());
  const put = (path, data) => {
    const parts = path.split('/');
    let directory = root.dir;
    for (const part of parts.slice(0, -1)) {
      if (!directory.contents.has(part)) directory.contents.set(part, new Directory(new Map()));
      directory = directory.contents.get(part);
    }
    directory.contents.set(parts.at(-1), new File(data));
  };
  const encoder = new TextEncoder();
  put('input.html', encoder.encode(job.html));
  put('style.css', encoder.encode(job.css));
  for (const file of [...job.fonts, ...job.assets]) put(file.name, file.data);
  let log = '';
  const collect = line => { if (log.length < 4000) log += String(line).slice(0, 4000 - log.length) + '\n'; };
  const wasi = new WASI(['fullbleed', String(job.maxPages), String(job.previewDpi), job.allowMissingGlyphs ? 'allow' : 'reject', ...job.fonts.map(f => f.name)], [], [
    new OpenFile(new File([])), ConsoleStdout.lineBuffered(collect), ConsoleStdout.lineBuffered(collect), root,
  ], { debug: false });
  const instance = await WebAssembly.instantiate(job.module, { wasi_snapshot_preview1: wasi.wasiImport });
  const status = wasi.start(instance);
  if (status !== 0) {
    const code = ['PAGE_LIMIT', 'MISSING_GLYPHS', 'PREVIEW_FAILED'].find(c => log.includes(c + ':')) ?? 'RENDER_FAILED';
    parentPort.postMessage({ ok: false, code, message: log.trim() || `The engine exited with code ${status}.` });
  } else {
    const read = name => {
      const file = root.dir.contents.get(name);
      if (!(file instanceof File)) throw new Error(`Missing engine output: ${name}`);
      return Uint8Array.from(file.data);
    };
    const report = JSON.parse(new TextDecoder().decode(read('result.json')));
    const pdf = read('document.pdf');
    if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') throw new Error('Engine output is not a PDF.');
    const previews = job.previewDpi ? Array.from({ length: report.pages }, (_, i) => read(`preview-${i + 1}.png`)) : [];
    parentPort.postMessage({ ok: true, pdf, previews, ...report }, [pdf.buffer, ...previews.map(p => p.buffer)]);
  }
} catch (cause) {
  const code = cause instanceof WebAssembly.RuntimeError || cause instanceof RangeError ? 'ENGINE_LIMIT' : 'RENDER_FAILED';
  parentPort.postMessage({ ok: false, code, message: cause.message || String(cause) });
}
