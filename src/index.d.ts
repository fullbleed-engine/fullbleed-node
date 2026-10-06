// SPDX-License-Identifier: MIT
import type { Buffer } from 'node:buffer';

export interface RenderOptions {
  html: string;
  css?: string;
  /** Additional TrueType font files, as bytes. Use their family names in CSS. */
  fonts?: readonly Uint8Array[];
  /** Relative asset names; reference them as assets/name.svg in HTML/CSS. */
  assets?: Readonly<Record<string, Uint8Array>>;
  /** 0 disables previews (default); otherwise 36–300 DPI. */
  previewDpi?: number;
  /** Includes initial engine loading. Default: 30000 ms. */
  timeoutMs?: number;
  /** Reject documents larger than this. Default: 1000. */
  maxPages?: number;
  /** Default false: missing glyphs reject the job instead of silently emitting them. */
  allowMissingGlyphs?: boolean;
  signal?: AbortSignal;
  /** Default: worker. Process starts a fresh Node child and waits for its exit. */
  isolation?: 'worker' | 'process';
}

export interface RenderResult {
  pdf: Buffer;
  previews: Buffer[];
  pages: number;
  missingGlyphs: number;
  engineVersion: string;
}

export class FullbleedError extends Error {
  readonly code: string;
  /** Present on PROCESS_FAILED errors after the child closes. */
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  constructor(code: string, message: string, options?: ErrorOptions);
}
export function renderPdf(options: RenderOptions): Promise<RenderResult>;
export const engineVersion: string;
export const version: string;
