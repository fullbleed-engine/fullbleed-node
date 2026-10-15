import { createRenderer, FullbleedError, version, engineVersion } from 'fullbleed/browser';

const renderer = createRenderer({ assetBaseUrl: new URL('/fullbleed/', location.href) });
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
