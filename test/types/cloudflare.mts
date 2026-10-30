import { renderPdf, renderPdfBatch, FullbleedError, version, engineVersion, type CloudflareRenderOptions } from 'fullbleed/cloudflare';
import { document, Heading, Paragraph } from 'fullbleed/ui';
const authored = document(Heading('Worker report'), Paragraph('Component-authored PDF.'));
const options: CloudflareRenderOptions = { html: authored.toHtml(), css: authored.toCss(), maxPages: 5 };
renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: new Uint8Array([1]) }] });
// @ts-expect-error Named font data must be bytes.
renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: 'file contents' }] });
const result = await renderPdf(options);
const pdf: Uint8Array<ArrayBuffer> = result.pdf;
new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
await authored.renderPdf(renderPdf, { maxPages: 5, defaultStyles: false });
const labels: string[] = [version, engineVersion, new FullbleedError('EXAMPLE', 'Example').code];
void labels;
// @ts-expect-error Workers cannot implement an interruptible SDK timeout.
await renderPdf({ html: 'x', timeoutMs: 1000 });
// @ts-expect-error Worker and process isolation are Node options.
await renderPdf({ html: 'x', isolation: 'worker' });
// @ts-expect-error In-isolate rendering cannot process cancellation during computation.
await renderPdf({ html: 'x', signal: new AbortController().signal });
const batch = await renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1042' }], layout: 'fixed' });
new Response(batch.pdf);
const pages: number = batch.records[0].pageCount;
void pages;
// @ts-expect-error Batch CPU deadlines remain platform-owned.
renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1042' }], timeoutMs: 5000 });
// @ts-expect-error A batch requires record data.
renderPdfBatch({ html: '<p>{{account}}</p>' });
