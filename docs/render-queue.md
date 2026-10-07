# Bound PDF work in a Node application

`createRenderQueue()` adds admission control around the Node renderer. Reuse one
queue across a server's requests or a batch of automation jobs. It starts jobs in
FIFO order, limits active work, and rejects excess waiting work with `QUEUE_FULL`.
Independent queues and standalone `renderPdf()` calls have independent limits.

```javascript
import { createRenderQueue, FullbleedError } from 'fullbleed';

const documents = createRenderQueue({ concurrency: 2, maxQueue: 4 });

try {
  const pdf = await documents.renderPdf({
    html: '<h1>Invoice NS-1042</h1><p>Consulting: USD 1,200.00</p>',
    isolation: 'process',
    timeoutMs: 30_000,
    signal: AbortSignal.timeout(20_000),
  });
  // Send pdf.pdf to the requesting user or save it in your application's storage.
} catch (error) {
  if (error instanceof FullbleedError && error.code === 'QUEUE_FULL') {
    // The request was not admitted. A web server can return HTTP 503.
  } else {
    throw error;
  }
}

// Call at application shutdown, rather than after each request:
await documents.close();
```

The factory defaults to `concurrency: 1` and `maxQueue: 16`. Both are safe integers;
concurrency must be positive and the waiting limit can be zero. A zero waiting
limit accepts only immediately available active slots. Unknown options reject
with `INVALID_INPUT`. Invalid document options reject without consuming a slot.

## Cancellation and deadlines

The document's `timeoutMs` starts when `queue.renderPdf()` is called, including
input validation, waiting, engine loading and rendering. An expired waiting job
rejects with `TIMEOUT` and never starts a worker. An aborted waiting job rejects
with `ABORTED` and immediately frees its waiting slot. Active cancellation keeps
the active slot occupied until the worker or child process exits.

Accepted inputs snapshot HTML/CSS strings and copy supplied asset/font bytes.
Changing the caller's objects or buffers while a job waits does not change its
output. The same structured render failures are reported as by `renderPdf()`;
a failed job releases its slot so later jobs can proceed. Jobs are never retried
automatically.

`activeCount` and `pendingCount` are read-only counts for this queue. `closed`
becomes true as soon as `close()` is called. Closing rejects new submissions,
rejects accepted unfinished jobs with `QUEUE_CLOSED`, and waits for their
worker/process cleanup. Calling it again returns the same promise. If accepted
jobs must finish normally, await those jobs before closing the queue.

## Server and automation boundaries

Keep the queue at application scope. Creating a new queue for every HTTP request
does not limit concurrency across those requests. A multi-process deployment
has a separate queue in each process; configure each instance for its resources.

The limits count jobs. They do not cap total application memory or establish a
safe production capacity for every document. Waiting jobs retain their input
snapshots, and previews use more memory than PDF-only output. Pick limits for the
host and document sizes and monitor both counts. Use `QUEUE_FULL` as an admission
signal to the caller or your existing job system.

The queue is in memory and is lost on application exit. Durable order events,
scheduled generation, retries, authentication and record storage belong in the
application. `isolation: 'process'` still requires a host that allows child
processes and incurs their startup overhead. The queue does not pool workers,
change the engine, or establish a fix for the native failure in
[issue #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7).

For a runnable batch, build this checkout and execute:

```sh
node examples/render-queue.mjs
```

It renders six fictional invoices using the existing Northstar design, limits
concurrency to two, and writes the PDFs and one preview to `output/queued-invoices`.

## Verification

The installed-tarball checks submit six synthetic invoice renders through two
active slots and four waiting slots, observe actual worker lifetimes, and compare
PDF and preview bytes with standalone rendering. They also exercise overload,
FIFO starts, queued and active cancellation, waiting deadlines, input snapshots,
render failure, shutdown before and after startup, and recovery after terminating
a process-isolated child. CI runs these checks on Node 22, 24 and 26 across Linux,
Windows and macOS. The [release evidence](https://github.com/fullbleed-engine/fullbleed-node/releases)
retains the observed results and PDF/PNG fixtures; it is not a general throughput
or memory-capacity claim.
