import api = require('fullbleed');
import type { Buffer } from 'node:buffer';
async function example() {
  const result = await api.renderPdf({ html: 'CommonJS types', isolation: 'process', defaultStyles: false });
  await api.renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: new Uint8Array([1]) }] });
  const pdf: Buffer = result.pdf;
  const error: Error = new api.FullbleedError('EXAMPLE', 'Example');
  const queue: api.RenderQueue = api.createRenderQueue({ concurrency: 1, maxQueue: 2 });
  await queue.renderPdf({ html: 'Queued CommonJS' });
  await queue.close();
  return { pdf, error };
}
void example;
