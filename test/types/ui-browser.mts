import { createRenderer, type BrowserRenderResult } from 'fullbleed/browser';
import { Document, Paragraph, renderDocument } from 'fullbleed/ui';
const renderer = createRenderer({ assetBaseUrl: '/fullbleed/' });
const doc = Document(Paragraph('Browser'));
const output: Promise<BrowserRenderResult> = renderDocument(doc, renderer, { previewDpi: 96 });
output.then(result => new Blob([result.pdf], { type: 'application/pdf' }));
// @ts-expect-error Node process isolation is not a browser option.
doc.renderPdf(renderer, { isolation: 'process' });
// @ts-expect-error Types must resolve through the browser export condition without Node types.
doc.renderPdf(renderer, { previewDpi: '96' });
