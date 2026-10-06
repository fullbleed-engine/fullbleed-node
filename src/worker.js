// SPDX-License-Identifier: MIT
import { parentPort, workerData } from 'node:worker_threads';
import { runEngine } from './engine-runner.js';

const result = await runEngine(workerData);
parentPort.postMessage(result, result.ok ? [result.pdf.buffer, ...result.previews.map(page => page.buffer)] : []);
