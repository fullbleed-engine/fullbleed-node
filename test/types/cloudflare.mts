import { renderPdf, FullbleedError, version, engineVersion, type CloudflareRenderOptions } from 'fullbleed/cloudflare';
import { document, Heading, Paragraph } from 'fullbleed/ui';
const authored = document(Heading('Worker report'), Paragraph('Component-authored PDF.'));
const options: CloudflareRenderOptions = { html: authored.toHtml(), css: authored.toCss(), maxPages: 5 };
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
