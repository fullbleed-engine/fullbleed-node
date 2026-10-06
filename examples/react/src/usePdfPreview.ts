// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRenderer, FullbleedError } from 'fullbleed/browser';
import type { BrowserRenderOptions } from 'fullbleed/browser';

export type PdfInput = Omit<BrowserRenderOptions, 'signal'>;
export interface PdfPreview {
  url: string;
  previews: string[];
  pages: number;
  bytes: number;
  engineVersion: string;
}
type Status = 'idle' | 'queued' | 'rendering' | 'ready' | 'cancelled' | 'error';
interface State {
  input: PdfInput;
  assetBaseUrl: string;
  status: Status;
  result?: PdfPreview;
  error?: { code: string; message: string };
}

/** Keep input stable with useMemo. This hook owns its workers, timers and Blob URLs. */
export function usePdfPreview(input: PdfInput, assetBaseUrl: string, { auto = true, delayMs = 450 } = {}) {
  const [state, setState] = useState<State>({ input, assetBaseUrl, status: 'idle' });
  const work = useRef({ mounted: false, serial: 0, controller: null as AbortController | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined, urls: [] as string[] });

  const release = useCallback(() => {
    const current = work.current;
    current.serial += 1;
    clearTimeout(current.timer);
    current.timer = undefined;
    current.controller?.abort();
    current.controller = null;
    current.urls.forEach(url => URL.revokeObjectURL(url));
    current.urls = [];
  }, []);

  const generate = useCallback(async () => {
    const current = work.current;
    release();
    if (!current.mounted) return;
    const serial = current.serial;
    const controller = new AbortController();
    current.controller = controller;
    setState({ input, assetBaseUrl, status: 'rendering' });
    try {
      const renderer = createRenderer({ assetBaseUrl });
      const rendered = await renderer.renderPdf({ ...input, signal: controller.signal });
      // An aborted or superseded request must never replace a newer document.
      if (!current.mounted || serial !== current.serial) return;
      const makeUrl = (bytes: Uint8Array<ArrayBuffer>, type: string) => {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        current.urls.push(url);
        return url;
      };
      const url = makeUrl(rendered.pdf, 'application/pdf');
      const previews = rendered.previews.map(bytes => makeUrl(bytes, 'image/png'));
      setState({ input, assetBaseUrl, status: 'ready', result: { url, previews, pages: rendered.pages,
        bytes: rendered.pdf.byteLength, engineVersion: rendered.engineVersion } });
    } catch (error) {
      if (!current.mounted || serial !== current.serial) return;
      current.urls.forEach(url => URL.revokeObjectURL(url));
      current.urls = [];
      setState({ input, assetBaseUrl, status: 'error', error: {
        code: error instanceof FullbleedError ? error.code : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      } });
    } finally {
      if (serial === current.serial) current.controller = null;
    }
  }, [input, assetBaseUrl, release]);

  useEffect(() => {
    work.current.mounted = true;
    release();
    setState({ input, assetBaseUrl, status: auto ? 'queued' : 'idle' });
    if (auto) work.current.timer = setTimeout(() => { void generate(); }, delayMs);
    return () => {
      work.current.mounted = false;
      release();
    };
  }, [input, assetBaseUrl, auto, delayMs, generate, release]);

  const cancel = useCallback(() => {
    release();
    if (work.current.mounted) setState({ input, assetBaseUrl, status: 'cancelled' });
  }, [input, assetBaseUrl, release]);

  // Hide an old download during the render before the input-change Effect runs.
  const visible: State = state.input === input && state.assetBaseUrl === assetBaseUrl
    ? state : { input, assetBaseUrl, status: auto ? 'queued' : 'idle' };
  return { ...visible, generate, cancel };
}
