# Engine 2.5.22 in JavaScript

Package 0.4.1 bundles the unmodified published Fullbleed 2.5.22 crate. Its Node
and browser entries use the same WebAssembly engine. Install it with:

```sh
npm install --save-exact fullbleed@0.4.1
```

The adapter now enables the engine's `svg_raster` feature so SVG border images
can use its native raster fallback. This adds no external rendering dependency.
The build and copied browser manifests record the enabled feature.

The public JavaScript API and its memory limit are unchanged. Review existing
PDF baselines when upgrading: corrected layout can change document appearance.

The [fixture provenance](../test/fixtures/engine-2.5.22.json) retains thirteen
focused cases from the engine release, including the original expected results:

| Document behavior | Independent check |
| --- | --- |
| Numbered sections and nested counters | Extracted labels, including resets across pages |
| Filtered content inside clipped containers | Interior pixel colors in finalized previews and independently rendered PDFs |
| Border images with insufficient space or a zero edge | Raster and SVG tile colors and empty regions |
| Decorated left/right initials and pagination | Character positions and colored bounds from retained Chrome print references using identical font bytes |

The Node fixture runner renders through worker and process isolation and checks
repeat output and equality between the two modes. The native adapter comparison
covers these same fixtures. The browser checks download the actual PDFs and
previews, compare their hashes with the installed npm package, then apply the
independent expectations to the downloads.

The custom Noto Sans font is a licensed test asset. It is excluded from the npm
tarball and does not add an application dependency.

From a built source checkout, with the verifier dependencies installed:

```sh
npm run verify:pack
node tools/render-engine-regressions.mjs
python tools/verify-engine-regressions.py
npm run verify:browser:prepare
python tools/check-browser.py --browser chrome --label candidate
python tools/verify-engine-regressions.py output/browser-chrome-candidate --browser
```

Use a fresh output directory for each retained run. `render-engine-regressions.mjs`
accepts `--out` and `--package-root` to check a separate installed package. For
the public 0.4.0 comparison, pass `--negative-control` to the Python verifier;
it requires at least one failing case in each of the four fix families.

These are targeted integration checks. They do not establish complete CSS
parity or PDF/UA, PDF/A, PDF/X, or PDF/VT conformance. The known runtime diagnostic
in [issue #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7) remains
separate from this engine update.
