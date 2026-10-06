// SPDX-License-Identifier: MIT
export interface BrowserRendererOptions {
  /** Same-origin directory URL ending in /, containing the copied browser assets. */
  assetBaseUrl: string | URL;
}
export interface BrowserRenderOptions {
  html: string;
  css?: string;
  /** Additional TrueType font bytes; use the font family names in CSS. */
  fonts?: readonly Uint8Array[];
  /** Relative names referenced as assets/name.svg in document HTML/CSS. */
  assets?: Readonly<Record<string, Uint8Array>>;
  /** 0 disables previews (default); otherwise 36–300 DPI. */
  previewDpi?: number;
  /** Includes worker startup and asset loading. Default: 30000 ms. */
  timeoutMs?: number;
  maxPages?: number;
  allowMissingGlyphs?: boolean;
  signal?: AbortSignal;
}
export interface BrowserRenderResult {
  pdf: Uint8Array<ArrayBuffer>;
  previews: Uint8Array<ArrayBuffer>[];
  pages: number;
  missingGlyphs: number;
  engineVersion: string;
}
export interface BrowserRenderer {
  renderPdf(options: BrowserRenderOptions): Promise<BrowserRenderResult>;
}
export class FullbleedError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}
export function createRenderer(options: BrowserRendererOptions): BrowserRenderer;
export const version: string;
export const engineVersion: string;
