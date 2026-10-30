// SPDX-License-Identifier: MIT
export interface BatchOptions {
  /** Up to 10,000 records with identical own enumerable fields and string values. Values are plain text. */
  records: readonly Readonly<Record<string, string>>[];
  /** Default reflow: text can wrap and change page counts. Fixed retains compiled geometry and fonts. */
  layout?: 'fixed' | 'reflow';
}
export interface MissingGlyph {
  codepoint: number;
  char: string;
  count: number;
  /** The first selected registered font where the character was absent. */
  fontsTried: string[];
}
export interface BatchRecordReport {
  /** Zero-based position in the input records. */
  recordIndex: number;
  /** Zero-based first page in the combined PDF. */
  pageOffset: number;
  pageCount: number;
  /** Selected registered-font coverage only; excludes Base-14/image text and is not a conformance check. */
  missingGlyphs: MissingGlyph[];
}
