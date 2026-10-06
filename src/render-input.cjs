// SPDX-License-Identifier: MIT
'use strict';

class FullbleedError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'FullbleedError';
    this.code = code;
  }
}
const invalid = message => { throw new FullbleedError('INVALID_INPUT', message); };
const sourceLimit = 4_000_000;
const assetLimit = 64 * 1024 * 1024;

function normalize(options, { browser = false } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Pass an options object with an html string.');
  const supported = new Set(['html', 'css', 'fonts', 'assets', 'previewDpi', 'timeoutMs', 'maxPages', 'allowMissingGlyphs', 'signal']);
  if (!browser) supported.add('isolation');
  for (const key of Object.keys(options)) if (!supported.has(key)) invalid(`Unknown option: ${key}`);
  const { html, css = '', fonts = [], assets = {}, previewDpi = 0, timeoutMs = 30000, maxPages = 1000, allowMissingGlyphs = false, signal, isolation = 'worker' } = options;
  if (typeof html !== 'string' || !html.trim()) invalid('html must be a nonempty string.');
  if (typeof css !== 'string') invalid('css must be a string.');
  if (new TextEncoder().encode(html).byteLength + new TextEncoder().encode(css).byteLength > sourceLimit) invalid('HTML and CSS together must not exceed 4,000,000 UTF-8 bytes.');
  if (!Number.isInteger(previewDpi) || (previewDpi !== 0 && (previewDpi < 36 || previewDpi > 300))) invalid('previewDpi must be 0 (disabled) or an integer from 36 to 300.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) invalid('timeoutMs must be a positive integer no greater than 2147483647.');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) invalid('maxPages must be a positive integer.');
  if (typeof allowMissingGlyphs !== 'boolean') invalid('allowMissingGlyphs must be a boolean.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) invalid('signal must be an AbortSignal.');
  if (isolation !== 'worker' && isolation !== 'process') invalid('isolation must be worker or process.');
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
  return { html, css, customFonts, assetFiles, previewDpi, timeoutMs, maxPages, allowMissingGlyphs, signal, isolation };
}

module.exports = { FullbleedError, normalize };
