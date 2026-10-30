// SPDX-License-Identifier: MIT
'use strict';
// Test-only child used to exercise the parent's IPC and shutdown handling.
const { renderPdf, renderPdfBatch } = require('fullbleed');
process.once('message', async message => {
  const mode = process.argv[2];
  if (mode === 'no-result') return process.disconnect();
  if (mode === 'invalid-result') {
    return process.send({ type: 'result', ok: true, result: { pdf: Buffer.from('invalid') } });
  }
  const render = message.type === 'render-batch' ? renderPdfBatch : renderPdf;
  const result = await render({ ...message.options, isolation: 'worker' });
  if (mode === 'invalid-batch-report') result.records[0].pageOffset = 1;
  const reply = { type: 'result', ok: true, result };
  process.send(reply, () => {
    if (mode === 'fail-after-result') process.exit(23);
    else if (mode === 'duplicate-result') process.send(reply);
  });
});
