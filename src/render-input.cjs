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
const recordLimit = 10_000;

function snapshotBatch(options, sourceBytes, maxSourceBytes) {
  const { records, layout = 'reflow' } = options;
  if (layout !== 'fixed' && layout !== 'reflow') invalid('layout must be fixed or reflow.');
  const recordCount = Array.isArray(records) ? records.length : undefined;
  if (!Number.isSafeInteger(recordCount) || recordCount < 1 || recordCount > recordLimit) {
    invalid(`records must be a nonempty array with at most ${recordLimit.toLocaleString('en-US')} records.`);
  }
  const encoder = new TextEncoder();
  const text = (value, label) => {
    if (typeof value !== 'string') invalid(`${label} must be a string; format numbers and dates before rendering.`);
    for (const character of value) {
      const point = character.codePointAt(0);
      if (point >= 0xd800 && point <= 0xdfff) invalid(`${label} contains an unpaired UTF-16 surrogate.`);
    }
    sourceBytes += encoder.encode(value).byteLength;
    if (sourceBytes > maxSourceBytes) invalid(`HTML, CSS and record keys/values together must not exceed ${maxSourceBytes.toLocaleString('en-US')} UTF-8 bytes.`);
    return value;
  };
  let fields;
  const copied = [];
  for (let index = 0; index < recordCount; index++) {
    if (!Object.hasOwn(records, index)) invalid(`records[${index}] is missing.`);
    const row = records[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid(`records[${index}] must map field names to strings.`);
    if (Object.getOwnPropertySymbols(row).some(key => Object.prototype.propertyIsEnumerable.call(row, key))) {
      invalid(`records[${index}] field names must be strings.`);
    }
    const names = Object.keys(row).sort();
    if (!names.length || names.some(name => !name)) invalid(`records[${index}] must have nonempty field names.`);
    if (!fields) fields = names;
    else if (names.length !== fields.length || names.some((name, i) => name !== fields[i])) {
      invalid(`records[${index}] must have the same fields as records[0].`);
    }
    const copy = Object.create(null);
    for (const name of names) {
      text(name, `records[${index}] field name`);
      copy[name] = text(row[name], `records[${index}][${JSON.stringify(name)}]`);
    }
    copied.push(copy);
  }
  return { records: copied, layout };
}

function normalize(options, { browser = false, interruptible = true,
  maxSourceBytes = sourceLimit, maxAssetBytes = assetLimit, defaultMaxPages = 1000, batch = false } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Pass an options object with an html string.');
  const supported = new Set(['html', 'css', 'defaultStyles', 'fonts', 'assets', 'previewDpi', 'maxPages', 'allowMissingGlyphs']);
  if (batch) { supported.add('records'); supported.add('layout'); }
  if (interruptible) { supported.add('timeoutMs'); supported.add('signal'); }
  if (!browser) supported.add('isolation');
  for (const key of Object.keys(options)) if (!supported.has(key)) invalid(`Unknown option: ${key}`);
  const { html, css = '', defaultStyles = true, fonts = [], assets = {}, previewDpi = 0, timeoutMs = 30000, maxPages = defaultMaxPages, allowMissingGlyphs = false, signal, isolation = 'worker' } = options;
  if (typeof html !== 'string' || !html.trim()) invalid('html must be a nonempty string.');
  if (typeof css !== 'string') invalid('css must be a string.');
  if (typeof defaultStyles !== 'boolean') invalid('defaultStyles must be a boolean.');
  const sourceBytes = new TextEncoder().encode(html).byteLength + new TextEncoder().encode(css).byteLength;
  if (sourceBytes > maxSourceBytes) {
    invalid(`HTML and CSS together must not exceed ${maxSourceBytes.toLocaleString('en-US')} UTF-8 bytes.`);
  }
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
    if (assetBytes > maxAssetBytes) invalid(`Custom fonts and assets together must not exceed ${maxAssetBytes / (1024 * 1024)} MiB.`);
    return Uint8Array.from(value); // Snapshot caller-owned buffers before any await.
  }
  const fontNames = new Set();
  const customFonts = fonts.map((font, i) => {
    const named = !(font instanceof Uint8Array);
    let name = `custom-${i}.ttf`, data = font;
    if (named) {
      if (!font || typeof font !== 'object' || Array.isArray(font)
          || Object.keys(font).some(key => key !== 'name' && key !== 'data')) {
        invalid(`fonts[${i}] must be bytes or an object with name and data.`);
      }
      name = font.name;
      data = font.data;
      if (typeof name !== 'string' || !name || name.length > 120 || /^[. ]|[. ]$/.test(name)
          || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)
          || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
          || !/\.(ttf|otf)$/i.test(name)) {
        invalid(`fonts[${i}].name must be a portable TTF or OTF filename without folders (up to 120 characters).`);
      }
    }
    const key = name.normalize('NFC').toLowerCase();
    if (fontNames.has(key)) invalid(`Duplicate font filename: ${name}`);
    fontNames.add(key);
    // Keep user filenames out of the directory containing the bundled fonts.
    return { name: (named ? 'fonts/named/' : 'fonts/') + name, data: bytes(data, `fonts[${i}]`) };
  });
  const names = Object.keys(assets);
  const fileNames = new Set(names);
  const assetFiles = names.map(name => {
    const segments = name.split('/');
    if (!name || /[\\:\0]/.test(name) || segments.some(s => !s || s === '.' || s === '..')) invalid(`Invalid asset path: ${name}`);
    for (let i = 1; i < segments.length; i++) if (fileNames.has(segments.slice(0, i).join('/'))) invalid(`Asset is both a file and a directory: ${name}`);
    return { name: 'assets/' + name, data: bytes(assets[name], `assets[${name}]`) };
  });
  return { html, css, defaultStyles, customFonts, assetFiles, previewDpi, timeoutMs, maxPages, allowMissingGlyphs, signal, isolation,
    ...(batch ? { batch: snapshotBatch(options, sourceBytes, maxSourceBytes) } : {}) };
}

function stylesheet(job) {
  return (job.defaultStyles ? 'body { font-family: Inter; }\n' : '') + job.css;
}

module.exports = { FullbleedError, normalize, stylesheet };
