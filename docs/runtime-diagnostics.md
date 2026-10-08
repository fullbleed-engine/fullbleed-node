# Node runtime investigation

[Issue #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7) tracks an
intermittent Linux process crash with Node 24.21.0 and `fullbleed@0.1.2` during
Commerce pagination tests. Two jobs exited with SIGSEGV after completing a
32-item PDF and its preview, before completing the following 33-item PDF. A
native stack from that failure has not yet been captured.

`fullbleed@0.1.3` waits for each render worker to exit before settling its promise.
That fixes the independently reproduced worker-lifecycle defect in
[PR #8](https://github.com/fullbleed-engine/fullbleed-node/pull/8). It does not
establish the cause or resolution of the original native crash. A process signal
can terminate the application before JavaScript can return a `FullbleedError`.

Version 0.2.0 adds optional [process isolation](process-isolation.md), so a
render-child failure can be reported while the caller continues running. Its
fault-injection checks exercise termination, shutdown failure, and recovery.
They do not reproduce the original SIGSEGV or establish its cause; issue #7
remains open.

## Concurrent-render experiment, October 4, 2026

The [upstream Node report](https://github.com/nodejs/node/issues/66366) describes
Wasm import-wrapper collection failures in another application on Node 24.21.0.
The [V8 correction](https://github.com/v8/v8/commit/9b8ca54d5a) prevents adding
references to wrappers already being deleted. This is a hypothesis for the
Fullbleed investigation, not a confirmed diagnosis.

Earlier Fullbleed diagnostics repeated serial pagination. The new experiment
used the published, unchanged `fullbleed@0.1.3` tarball and ran overlapping
requests for the repository's invoice and three-page report, each with and
without 96-dpi previews. Four serial baselines were followed by 20 groups of
four concurrent renders. Each group waited for all workers to exit.

On Ubuntu 22.04 under WSL2, the official Node 24.21.0 Linux binary ran under GDB
with diagnostic V8 flags that increase wrapper tiering and code collection:

| Observation | Result |
| --- | --- |
| Completed renders / workers created | 84 / 84 |
| Peak simultaneous workers / workers left at completion | 4 / 0 |
| Logged code-collection starts / wrapper-free events | 64 / 13 |
| PDF and preview comparisons | All matched their serial baseline |
| Baseline files compared with published 0.1.3 release samples | All eight hashes matched |
| Native crash or debugger stop | None |

The [verification record](concurrent-render-verification.json) identifies the
package, scripts, runtime, fixture hashes, result counts, and retained evidence
archive. The archive includes the progress journal, debugger log, baseline PDFs
and PNGs, and comparison records. This is one bounded experiment in an
environment different from the original GitHub runner. It is not a throughput
measurement, capacity test, or proof that the crash is fixed.

## Cancellation during a Wasm host call, October 8, 2026 (UTC)

The earlier experiment let every render finish. This follow-up tested a different
condition: terminating a worker while its Wasm engine has an active host-call
stack, with other render workers alive. It used the same published
`fullbleed@0.1.3` package and official Node 24.21.0 Linux binary. All 18 package
files and all 26 WASI dependency files matched their registry tarballs.

The development-only observer intercepts worker creation and wraps the WASI
log collector. An empty HTML style block makes the engine emit an asset warning.
Inside that callback, the observer captures a stack containing Wasm frames,
notifies the parent through a separate message channel, and waits. The parent
then cancels through Fullbleed's public `AbortSignal` option. The package files,
Wasm bytes, and Wasm import functions remain unchanged. The observer deliberately
changes timing: this tests cancellation at a paused host callback, not every
possible point during normal execution.

A one-round control verified the observer before one bounded, 20-round GDB run
with the same three diagnostic V8 flags as the earlier experiment. Each round
started two victims and two ordinary invoice/report renders; preview modes
alternated. Four serial renders supplied the output baselines.

| Observation | Result |
| --- | --- |
| Cancellations with an observed Wasm stack | 40 |
| Completed renders, including four serial baselines | 44 |
| Workers created / peak simultaneous / left at completion | 84 / 4 / 0 |
| Live workers when each abort was requested | 3 or 4 |
| Logged code-collection starts / wrapper-free events | 41 / 1 |
| Completed PDF and preview comparisons | All matched their serial baseline |
| Baseline files compared with published 0.1.3 samples | All eight hashes matched |
| Native crash or debugger stop | None |

The [verification record](active-cancellation-verification.json) links the
retained debugger log, per-cancellation stacks, progress journal, PDFs, PNGs,
and package/runtime checks. Its reviewed GC count comes from the retained trace;
the initial local runner searched for the wrong trace label and reported zero.
No diagnostic was rerun to correct that count. This single WSL2 experiment does
not reproduce the original GitHub-runner crash or establish its cause. Issue #7
remains open.

## Run a synthetic diagnostic

The diagnostic tools are repository development files, not part of the installed
npm package. Use a Linux host with Node, npm, and GDB installed. From this checkout,
the following creates a separate install of the published package; Rust and a
Fullbleed source build are unnecessary:

```bash
fullbleed_checkout="$(pwd)"
fullbleed_node="$(command -v node)"
fullbleed_diagnostic="$(mktemp -d)"
cd "$fullbleed_diagnostic"
npm init --yes
npm install --ignore-scripts --no-audit --no-fund --save-exact fullbleed@0.1.3
mkdir evidence

env -i PATH="$(dirname "$fullbleed_node"):/usr/bin:/bin" \
  LANG=C.UTF-8 TZ=UTC SHELL=/bin/sh \
  timeout --kill-after=10s 180s gdb --nh --nx --batch --return-child-result \
  -x "$fullbleed_checkout/tools/capture-native.gdb" --args "$fullbleed_node" \
  --stress-wasm-code-gc --wasm-wrapper-tiering-budget=1 --trace-wasm-code-gc \
  --report-on-fatalerror --report-uncaught-exception \
  --report-exclude-env --report-exclude-network \
  --report-directory="$fullbleed_diagnostic/evidence" \
  "$fullbleed_checkout/tools/diagnose-concurrent-renders.mjs" \
  "$fullbleed_diagnostic" "$fullbleed_checkout" \
  "$fullbleed_diagnostic/evidence/renders" \
  > "$fullbleed_diagnostic/evidence/process.log" 2>&1
```

These V8 flags are for investigation only. They are not a production workaround.
The recorded run used Node 24.21.0; record the exact version when comparing another
runtime. The script refuses an existing render-output directory, records job
starts synchronously, verifies output hashes, and fails on a render error or a
mismatch. A successful run ends its journal with `phase: "complete"`, 84 completed
renders, and zero active workers. Do not automatically retry a failed run.

For the cancellation probe, substitute
`tools/diagnose-active-cancellation.mjs` and use a fresh output directory. Its
default is 20 rounds; an optional final argument `1` selects the one-round
observer control. The 20-round completion record must contain 40 observed aborts,
44 completed renders, 84 workers created, and zero active workers. A missing
Wasm stack, resumed victim callback, unexpected error, or changed output hash
fails the probe. Keep the observer confined to this development process.

GDB prints `FULLBLEED_DEBUGGER_STOPPED_WITH_LIVE_INFERIOR` and native thread
stacks if it stops on a signal. A signal inside WebAssembly still needs analysis;
it is not automatically the original crash. Retain the command's exit status,
`evidence/process.log`, and the render directory together. A live-inferior marker
or a missing final `complete` event is a failed run even if GDB exits zero.
Use only synthetic
inputs in shareable diagnostics, as native stacks and reports can contain data
from the process being inspected.

Further investigation needs a failing native stack or a specific new hypothesis.
Repeating successful runs alone cannot justify closing issue #7.
