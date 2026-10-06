// SPDX-License-Identifier: MIT
import { onMounted, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, WatchHandle } from 'vue';
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

/** Call during component setup. Pass a computed input or a getter that reads reactive values. */
export function usePdfPreview(
  input: MaybeRefOrGetter<PdfInput>,
  assetBaseUrl: MaybeRefOrGetter<string>,
  { auto = true, delayMs = 450 }: { auto?: MaybeRefOrGetter<boolean>; delayMs?: number } = {},
) {
  const status = shallowRef<Status>('idle');
  const result = shallowRef<PdfPreview>();
  const error = shallowRef<{ code: string; message: string }>();
  let mounted = false;
  let serial = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: WatchHandle | undefined;
  let urls: string[] = [];

  function release() {
    serial += 1;
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
    result.value = undefined;
    error.value = undefined;
  }

  async function generate() {
    release();
    if (!mounted) return;
    const request = serial;
    const abort = new AbortController();
    controller = abort;
    status.value = 'rendering';
    try {
      const renderer = createRenderer({ assetBaseUrl: toValue(assetBaseUrl) });
      const rendered = await renderer.renderPdf({ ...toValue(input), signal: abort.signal });
      // A superseded request cannot create URLs or replace a newer document.
      if (!mounted || request !== serial) return;
      const makeUrl = (bytes: Uint8Array<ArrayBuffer>, type: string) => {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        urls.push(url);
        return url;
      };
      result.value = {
        url: makeUrl(rendered.pdf, 'application/pdf'),
        previews: rendered.previews.map(bytes => makeUrl(bytes, 'image/png')),
        pages: rendered.pages, bytes: rendered.pdf.byteLength, engineVersion: rendered.engineVersion,
      };
      status.value = 'ready';
    } catch (failure) {
      if (!mounted || request !== serial) return;
      urls.forEach(url => URL.revokeObjectURL(url));
      urls = [];
      error.value = {
        code: failure instanceof FullbleedError ? failure.code : 'UNKNOWN',
        message: failure instanceof Error ? failure.message : String(failure),
      };
      status.value = 'error';
    } finally {
      if (request === serial) controller = undefined;
    }
  }

  onMounted(() => {
    mounted = true;
    stop = watch([() => toValue(input), () => toValue(assetBaseUrl), () => toValue(auto)], () => {
      // Invalidate synchronously; even before Vue updates the DOM, the old URL is revoked.
      release();
      status.value = toValue(auto) ? 'queued' : 'idle';
      if (toValue(auto)) timer = setTimeout(() => { void generate(); }, delayMs);
    }, { immediate: true, flush: 'sync' });
  });

  onScopeDispose(() => {
    mounted = false;
    stop?.();
    release();
  });

  function cancel() {
    release();
    if (mounted) status.value = 'cancelled';
  }

  return { status: readonly(status), result: readonly(result), error: readonly(error), generate, cancel };
}
