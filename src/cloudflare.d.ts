// SPDX-License-Identifier: MIT
import type { BatchOptions, BatchRecordReport } from './batch.js';
export type { BatchOptions, BatchRecordReport, MissingGlyph } from './batch.js';
export interface CloudflareRenderOptions {
  /** HTML and CSS together are limited to 1,000,000 UTF-8 bytes. */
  html: string;
  css?: string;
  /** Default true: prepend the package's Inter body rule. False preserves CSS. */
  defaultStyles?: boolean;
  /** Font bytes or named TTF/OTF files for CSS aliases. Fonts and assets together are limited to 8 MiB. */
  fonts?: readonly (Uint8Array | { readonly name: string; readonly data: Uint8Array })[];
  /** Relative names referenced as assets/name.svg in document HTML/CSS. */
  assets?: Readonly<Record<string, Uint8Array>>;
  /** 0 disables previews (default); otherwise 36–300 DPI. Account for Worker memory. */
  previewDpi?: number;
  /** Default 20. This is a page limit, not a CPU or memory guarantee. */
  maxPages?: number;
  allowMissingGlyphs?: boolean;
}
export interface CloudflareRenderResult {
  pdf: Uint8Array<ArrayBuffer>;
  previews: Uint8Array<ArrayBuffer>[];
  pages: number;
  missingGlyphs: number;
  engineVersion: string;
}
export class FullbleedError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}
/** Runs synchronously in the isolate and returns a settled Promise. No SDK cancellation or timeout. */
export function renderPdf(options: CloudflareRenderOptions): Promise<CloudflareRenderResult>;
export interface CloudflareBatchRenderOptions extends CloudflareRenderOptions, BatchOptions {}
export interface CloudflareBatchRenderResult extends CloudflareRenderResult {
  records: BatchRecordReport[];
}
/** Compile once per request. Template and records share the 1,000,000 UTF-8 byte limit; platform CPU limits apply. */
export function renderPdfBatch(options: CloudflareBatchRenderOptions): Promise<CloudflareBatchRenderResult>;
export const version: string;
export const engineVersion: string;
