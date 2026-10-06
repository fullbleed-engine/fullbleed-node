# Process isolation for server rendering

`fullbleed@0.2.0` adds `isolation: 'process'`. Each call launches a fresh Node
process containing the rendering worker and WebAssembly engine. A render-process
failure rejects that request; the caller can report the error and handle another
request. The default remains `isolation: 'worker'`.

```javascript
import { FullbleedError, renderPdf } from 'fullbleed';

try {
  const result = await renderPdf({
    html: '<h1>Invoice NS-1042</h1><p>Consulting: USD 1,200.00</p>',
    css: '@page { size: A4; margin: 20mm } h1 { color: #175c52 }',
    isolation: 'process',
    timeoutMs: 10_000,
    maxPages: 20,
  });
  // Return result.pdf from your authenticated HTTP handler.
} catch (error) {
  if (!(error instanceof FullbleedError)) throw error;
  console.error(error.code, error.exitCode, error.signal);
  // Return an appropriate error response; no partial PDF is returned.
}
```

## Lifecycle and errors

The caller snapshots input buffers before asynchronous work, then sends the
document to the child over Node IPC. Process mode does not compile WebAssembly
or create rendering workers in the caller. The engine version, document options,
PDF/PNG result shape, and document error codes are the same as worker mode.

The promise settles only after the process exits and IPC disconnects, including
on success. Receiving a PDF followed by a failed child exit is still a
`PROCESS_FAILED` error. Invalid or missing child responses and spawn failures
also use that code. When available, `exitCode` and `signal` describe the exit;
their values are platform dependent and may be `null`.

`TIMEOUT` and `ABORTED` terminate the child and wait for it to exit before
rejecting. The deadline includes startup and initial engine loading; cleanup
can take additional time. Losing the parent's IPC connection cancels rendering
in the child. Each call owns its child, so cancelling one request does not cancel
another.

## Deployment and cost

Use a normal Node.js 22+ executable on a host that permits child processes.
Keep the installed package's `src/`, `dist/`, and bundled font assets together;
bundlers must preserve these runtime files. Process startup uses `process.execPath`
and an argument array, without a shell. The child does not inherit application
`execArgv` flags or `NODE_OPTIONS`, so application preloads, custom loaders, inline
scripts, and inspector flags are not replayed. Other environment variables are
inherited. Windows children have no visible console window.

Each request starts a process and compiles its engine, adding latency and memory
compared with worker mode. There is no process pool or automatic retry. Bound
concurrency according to the host's available memory. Each rendering worker's
WebAssembly memory has a 512 MiB ceiling; total process memory can exceed that,
especially with previews. This feature does not establish server capacity or
make an out-of-memory host safe.

This is a fault-containment option, not an operating-system security sandbox.
It is not qualified for browser or edge runtimes, Electron, Node single-executable
applications, or hosts that prohibit child processes.

## Verification scope

The tests use real child processes and synthetic documents. They check matching
PDF/PNG bytes, custom-font and asset snapshots, termination and recovery, a valid
PDF followed by a deliberate nonzero exit, malformed and missing IPC responses,
spawn failure, IPC loss, timeouts, cancellation, concurrent request independence,
and preserved document errors.

The packed-package check installs the tarball with a fresh npm cache, then
reinstalls offline from its lockfile. A separate consumer forbids WebAssembly
compilation and rendering workers in the parent, sets application preloads that
must not run in children, checks ESM/CommonJS and inline module callers, forces a
child termination, and renders again. It retains PDF/PNG bytes and hashes. CI
checks Node 22, 24, and 26 on Linux, Windows, and macOS.

The forced failures establish handling of those failure paths. They do not
reproduce or fix the intermittent native crash tracked in
[issue #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7). That
investigation remains open; see [the retained diagnostics](runtime-diagnostics.md).
