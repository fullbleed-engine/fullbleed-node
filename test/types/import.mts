import { renderPdf, FullbleedError, type RenderOptions, type RenderResult } from 'fullbleed';
import type { Buffer } from 'node:buffer';
const options: RenderOptions = { html: '<h1>Typed PDF</h1>', fonts: [new Uint8Array([1])], previewDpi: 96 };
const result: RenderResult = await renderPdf(options);
const bytes: Buffer = result.pdf;
const code: string = new FullbleedError('EXAMPLE', 'Example').code;
void bytes; void code;
// @ts-expect-error The adapter does not accept unimplemented profile options.
renderPdf({ html: 'Hello', pdfProfile: 'pdfua1' });
