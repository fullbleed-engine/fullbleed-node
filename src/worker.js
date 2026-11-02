// SPDX-License-Identifier: MIT
import { parentPort, workerData } from 'node:worker_threads';
import { runEngineSync } from './engine-runner.js';

// Finish module evaluation before starting CPU-bound work. Cancellation during
// the dynamic import can otherwise leave worker.terminate() pending on Windows.
setImmediate(() => {
  const result = runEngineSync(workerData);
  parentPort.postMessage(result, result.ok ? [result.pdf.buffer, ...result.previews.map(page => page.buffer)] : []);
});
