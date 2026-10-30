// SPDX-License-Identifier: MIT
'use strict';

// Validate reports before trusting worker/process replies or allocating previews.
function validBatchReport(result, job) {
  if (!job.batch) return result?.records === undefined;
  if (!Number.isSafeInteger(result?.pages) || result.pages < 1 || result.pages > job.maxPages
      || !Number.isSafeInteger(result.missingGlyphs) || result.missingGlyphs < 0
      || !Array.isArray(result.records) || result.records.length !== job.batch.records.length) return false;
  let offset = 0;
  const allMissing = new Set();
  for (let index = 0; index < result.records.length; index++) {
    const row = result.records[index];
    if (!row || row.recordIndex !== index || row.pageOffset !== offset
        || !Number.isSafeInteger(row.pageCount) || row.pageCount < 1
        || row.pageCount > result.pages - offset || !Array.isArray(row.missingGlyphs)) return false;
    offset += row.pageCount;
    const seen = new Set();
    for (const glyph of row.missingGlyphs) {
      if (!glyph || !Number.isInteger(glyph.codepoint) || glyph.codepoint < 0 || glyph.codepoint > 0x10ffff
          || (glyph.codepoint >= 0xd800 && glyph.codepoint <= 0xdfff)
          || glyph.char !== String.fromCodePoint(glyph.codepoint)
          || !Number.isSafeInteger(glyph.count) || glyph.count < 1
          || !Array.isArray(glyph.fontsTried) || !glyph.fontsTried.length
          || !Array.from(glyph.fontsTried).every(font => typeof font === 'string' && font.length > 0)
          || seen.has(glyph.codepoint)) return false;
      seen.add(glyph.codepoint);
      allMissing.add(glyph.codepoint);
    }
  }
  return offset === result.pages && allMissing.size === result.missingGlyphs
    && (job.allowMissingGlyphs || allMissing.size === 0);
}

const batchResult = (result, job) => job.batch ? { records: result.records } : {};
function validRenderResult(result, job) {
  return result?.pdf instanceof Uint8Array && [37, 80, 68, 70, 45].every((byte, i) => result.pdf[i] === byte)
    && Number.isSafeInteger(result.pages) && result.pages > 0 && result.pages <= job.maxPages
    && Number.isSafeInteger(result.missingGlyphs) && result.missingGlyphs >= 0
    && (job.allowMissingGlyphs || result.missingGlyphs === 0)
    && Array.isArray(result.previews) && result.previews.length === (job.previewDpi ? result.pages : 0)
    && Array.from(result.previews).every(bytes => bytes instanceof Uint8Array
      && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
    && validBatchReport(result, job);
}
module.exports = { validBatchReport, validRenderResult, batchResult };
