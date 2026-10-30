import { renderPdf, renderPdfBatch, createRenderQueue, FullbleedError, type RenderOptions, type RenderResult, type RenderQueue, type BatchRenderOptions, type BatchRenderResult } from 'fullbleed';
import type { Buffer } from 'node:buffer';
const options: RenderOptions = { html: '<h1>Typed PDF</h1>', defaultStyles: false, fonts: [new Uint8Array([1])], previewDpi: 96, isolation: 'process' };
renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: new Uint8Array([1]) }] });
// @ts-expect-error Named font data must be bytes.
renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: 'file contents' }] });
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
// @ts-expect-error Style injection is a boolean choice.
renderPdf({ html: 'Hello', defaultStyles: 'false' });
const batchOptions: BatchRenderOptions = { html: '<p>{{account}}</p>', records: [{ account: '1042' }] as const, layout: 'reflow' };
const batch: BatchRenderResult = await renderPdfBatch(batchOptions);
const batchPdf: Buffer = batch.pdf;
const pageOffset: number = batch.records[0].pageOffset;
const selectedFont: string | undefined = batch.records[0].missingGlyphs[0]?.fontsTried[0];
await queue.renderPdfBatch(batchOptions);
void [batchPdf, pageOffset, selectedFont];
// @ts-expect-error Format record values explicitly as strings.
renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: 1042 }] });
// @ts-expect-error Batch rendering requires records.
renderPdfBatch({ html: '<p>{{account}}</p>' });
// @ts-expect-error Batch data belongs to the batch API.
renderPdf({ html: '<p>{{account}}</p>', records: [{ account: '1042' }] });
