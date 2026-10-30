// SPDX-License-Identifier: MIT
'use strict';
const { renderPdf, renderPdfBatch } = require('./index.cjs');
const controller = new AbortController();
process.once('disconnect', () => controller.abort());
process.once('message', async message => {
  let reply;
  try {
    if (message?.type !== 'render' && message?.type !== 'render-batch') throw new Error('Invalid render request.');
    const render = message.type === 'render-batch' ? renderPdfBatch : renderPdf;
    const result = await render({ ...message.options, isolation: 'worker', signal: controller.signal });
    reply = { type: 'result', ok: true, result };
  } catch (error) {
    reply = { type: 'result', ok: false, code: error.code ?? 'RENDER_FAILED', message: error.message };
  }
  if (!process.connected) return;
  process.send(reply, error => {
    if (error) process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
});
