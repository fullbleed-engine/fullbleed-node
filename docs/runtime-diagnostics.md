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

## Run the same synthetic diagnostic

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
mkdir evidence empty-home

env -i PATH="$(dirname "$fullbleed_node"):/usr/bin:/bin" \
  HOME="$fullbleed_diagnostic/empty-home" LANG=C.UTF-8 TZ=UTC SHELL=/bin/sh \
  timeout --kill-after=10s 180s gdb --batch --return-child-result \
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
