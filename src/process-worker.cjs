// SPDX-License-Identifier: MIT
'use strict';
const { renderPdf } = require('./index.cjs');
const controller = new AbortController();
process.once('disconnect', () => controller.abort());
process.once('message', async message => {
  let reply;
  try {
    if (message?.type !== 'render') throw new Error('Invalid render request.');
    const result = await renderPdf({ ...message.options, isolation: 'worker', signal: controller.signal });
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
