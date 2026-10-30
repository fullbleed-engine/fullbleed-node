import { createRenderer, FullbleedError, version, engineVersion } from 'fullbleed/browser';

const renderer = createRenderer({ assetBaseUrl: new URL('/fullbleed/', location.href) });
renderer.renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: new Uint8Array([1]) }] });
// @ts-expect-error Named font data must be bytes.
renderer.renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: 'file contents' }] });
const result = await renderer.renderPdf({ html: '<h1>Browser PDF</h1>', defaultStyles: false, previewDpi: 96, signal: new AbortController().signal });
const pdf: Uint8Array = result.pdf;
const png: Uint8Array = result.previews[0];
const versions: string[] = [version, engineVersion, result.engineVersion];
new Blob([result.pdf], { type: 'application/pdf' });
new FullbleedError('EXAMPLE', 'Example error');
// @ts-expect-error Browser calls do not start Node child processes.
renderer.renderPdf({ html: 'Example', isolation: 'process' });
// @ts-expect-error Asset locations must be explicit.
createRenderer({});
// @ts-expect-error Style injection is a boolean choice.
renderer.renderPdf({ html: 'Hello', defaultStyles: 'false' });
void [pdf, png, versions];
const batch = await renderer.renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1042' }] as const });
new Blob([batch.pdf], { type: 'application/pdf' });
const firstPage: number = batch.records[0].pageOffset;
void firstPage;
// @ts-expect-error Browser batches cannot start child processes.
renderer.renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1042' }], isolation: 'process' });
// @ts-expect-error Records contain strings, not HTML/component objects.
renderer.renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: { html: '1042' } }] });
