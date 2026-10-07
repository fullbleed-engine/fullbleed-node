import { renderPdf, createRenderQueue, FullbleedError, type RenderOptions, type RenderResult, type RenderQueue } from 'fullbleed';
import type { Buffer } from 'node:buffer';
const options: RenderOptions = { html: '<h1>Typed PDF</h1>', fonts: [new Uint8Array([1])], previewDpi: 96, isolation: 'process' };
const result: RenderResult = await renderPdf(options);
const bytes: Buffer = result.pdf;
const code: string = new FullbleedError('EXAMPLE', 'Example').code;
void bytes; void code;
const queue: RenderQueue = createRenderQueue({ concurrency: 2, maxQueue: 4 });
const queued: RenderResult = await queue.renderPdf(options);
const pending: number = queue.pendingCount;
await queue.close();
void queued; void pending;
// @ts-expect-error Queue statistics are read-only.
queue.activeCount = 3;
// @ts-expect-error Queue creation does not accept document or browser runtime options.
createRenderQueue({ assetBaseUrl: '/fullbleed/' });
// @ts-expect-error The adapter does not accept unimplemented profile options.
renderPdf({ html: 'Hello', pdfProfile: 'pdfua1' });
// @ts-expect-error Isolation modes are explicit, not arbitrary executables.
renderPdf({ html: 'Hello', isolation: 'browser' });
