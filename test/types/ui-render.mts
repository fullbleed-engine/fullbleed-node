import { renderPdf, createRenderQueue, type RenderResult } from 'fullbleed';
import { Document, Paragraph, renderDocument } from 'fullbleed/ui';
const doc = Document({ title: 'Types' }, Paragraph('Hello'));
const a: Promise<RenderResult> = doc.renderPdf(renderPdf, { previewDpi: 96, isolation: 'process' });
const queue = createRenderQueue();
const b: Promise<RenderResult> = renderDocument(doc, queue, { signal: new AbortController().signal });
const buffer: Promise<Buffer> = a.then(result => result.pdf);
// @ts-expect-error Renderer option types must survive the adapter.
doc.renderPdf(renderPdf, { previewDpi: '96' });
// @ts-expect-error Do not silently replace the authored document.
renderDocument(doc, renderPdf, { html: '<p>lost</p>' });
// @ts-expect-error Renderer options must remain checked for queue objects too.
renderDocument(doc, queue, { timeoutMs: 'long' });
void [a, b, buffer];
