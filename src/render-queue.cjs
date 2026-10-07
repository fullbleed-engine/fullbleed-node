// SPDX-License-Identifier: MIT
'use strict';
const { FullbleedError, normalize } = require('./render-input.cjs');

const failure = (code, message) => new FullbleedError(code, message);
const closedError = () => failure('QUEUE_CLOSED', 'The rendering queue is closed.');
const abortedError = () => failure('ABORTED', 'PDF rendering was aborted.');

function createQueue(run, options = {}) {
  const invalid = message => { throw failure('INVALID_INPUT', message); };
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Pass queue options as an object.');
  for (const key of Object.keys(options)) {
    if (key !== 'concurrency' && key !== 'maxQueue') invalid(`Unknown queue option: ${key}`);
  }
  const { concurrency = 1, maxQueue = 16 } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) invalid('concurrency must be a positive safe integer.');
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) invalid('maxQueue must be a nonnegative safe integer.');
  const pending = [];
  const active = new Set();
  let closed = false, closePromise, resolveClose;

  function finishClose() {
    if (closed && active.size === 0 && pending.length === 0) resolveClose();
  }

  function cleanup(entry) {
    clearTimeout(entry.timer);
    entry.sourceSignal?.removeEventListener('abort', entry.onAbort);
  }

  function cancel(entry, error) {
    if (entry.state === 'settled') return;
    if (entry.state === 'active') {
      entry.stopError ??= error;
      entry.controller.abort();
      return;
    }
    pending.splice(pending.indexOf(entry), 1);
    entry.state = 'settled';
    cleanup(entry);
    entry.reject(error);
    pump();
    finishClose();
  }

  function complete(entry, error, result) {
    // run() settles only after its worker or process exits. Keep the slot
    // occupied through that cleanup, including failure and cancellation.
    active.delete(entry);
    entry.state = 'settled';
    cleanup(entry);
    error = entry.stopError ?? error;
    if (error) entry.reject(error); else entry.resolve(result);
    pump();
    finishClose();
  }

  function pump() {
    if (closed) return;
    while (active.size < concurrency && pending.length) {
      const entry = pending.shift();
      entry.state = 'active';
      clearTimeout(entry.timer);
      active.add(entry);
      Promise.resolve().then(() => run(entry.job, entry.start)).then(
        result => complete(entry, null, result),
        error => complete(entry, error),
      );
    }
  }

  function admissionError() {
    if (closed) return closedError();
    if (active.size >= concurrency && pending.length >= maxQueue) {
      return failure('QUEUE_FULL', 'The rendering queue has no available slot.');
    }
  }

  function renderPdf(options) {
    let error = admissionError();
    if (error) return Promise.reject(error);
    const start = Date.now();
    let job;
    try { job = normalize(options); } catch (error) { return Promise.reject(error); }
    // Getters on the input can invoke application code during normalization.
    // Recheck admission before retaining the copied document buffers.
    error = admissionError();
    if (error) return Promise.reject(error);
    if (job.signal?.aborted) return Promise.reject(abortedError());
    const remaining = job.timeoutMs - (Date.now() - start);
    if (remaining <= 0) return Promise.reject(failure('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`));
    const sourceSignal = job.signal;
    const controller = new AbortController();
    job.signal = controller.signal;
    return new Promise((resolve, reject) => {
      const entry = { job, start, sourceSignal, controller, resolve, reject, state: 'pending' };
      entry.onAbort = () => cancel(entry, abortedError());
      pending.push(entry);
      entry.timer = setTimeout(() => cancel(entry,
        failure('TIMEOUT', `PDF rendering exceeded ${job.timeoutMs} ms.`)), remaining);
      sourceSignal?.addEventListener('abort', entry.onAbort, { once: true });
      if (sourceSignal?.aborted) entry.onAbort();
      else pump();
    });
  }

  function close() {
    if (closed) return closePromise;
    closed = true;
    closePromise = new Promise(resolve => { resolveClose = resolve; });
    for (const entry of [...pending, ...active]) cancel(entry, closedError());
    finishClose();
    return closePromise;
  }

  return Object.freeze({
    renderPdf, close, concurrency, maxQueue,
    get activeCount() { return active.size; },
    get pendingCount() { return pending.length; },
    get closed() { return closed; },
  });
}

module.exports = { createQueue };
