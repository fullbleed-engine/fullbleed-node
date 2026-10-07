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
  /** Includes queue wait and initial engine loading. Default: 30000 ms. */
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
export interface RenderQueueOptions {
  /** Maximum simultaneous renders in this queue. Default: 1. */
  concurrency?: number;
  /** Maximum waiting requests, excluding active renders. Default: 16; 0 rejects instead of waiting. */
  maxQueue?: number;
}
export interface RenderQueue {
  /** Render in FIFO start order, or reject with QUEUE_FULL/QUEUE_CLOSED. Inputs are copied at admission. */
  renderPdf(options: RenderOptions): Promise<RenderResult>;
  /** Stop admission, cancel accepted jobs and await worker/process cleanup. Idempotent. */
  close(): Promise<void>;
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly activeCount: number;
  readonly pendingCount: number;
  readonly closed: boolean;
}
export function createRenderQueue(options?: RenderQueueOptions): RenderQueue;
export const engineVersion: string;
export const version: string;
