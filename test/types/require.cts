import api = require('fullbleed');
import type { Buffer } from 'node:buffer';
async function example() {
  const result = await api.renderPdf({ html: 'CommonJS types', isolation: 'process', defaultStyles: false });
  await api.renderPdf({ html: 'Named font', fonts: [{ name: 'brand.ttf', data: new Uint8Array([1]) }] });
  const pdf: Buffer = result.pdf;
  const error: Error = new api.FullbleedError('EXAMPLE', 'Example');
  const queue: api.RenderQueue = api.createRenderQueue({ concurrency: 1, maxQueue: 2 });
  await queue.renderPdf({ html: 'Queued CommonJS' });
  const batch: api.BatchRenderResult = await api.renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1042' }], isolation: 'process' });
  const record: api.BatchRecordReport = batch.records[0];
  const batchPdf: Buffer = batch.pdf;
  await queue.renderPdfBatch({ html: '<p>{{account}}</p>', records: [{ account: '1043' }] });
  void [record, batchPdf];
  await queue.close();
  return { pdf, error };
}
void example;
