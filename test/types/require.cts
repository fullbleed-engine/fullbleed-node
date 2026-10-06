import api = require('fullbleed');
import type { Buffer } from 'node:buffer';
async function example() {
  const result = await api.renderPdf({ html: 'CommonJS types', isolation: 'process' });
  const pdf: Buffer = result.pdf;
  const error: Error = new api.FullbleedError('EXAMPLE', 'Example');
  return { pdf, error };
}
void example;
