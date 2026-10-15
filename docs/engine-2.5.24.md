# Engine 2.5.24 update checks

The engine update is being prepared. Publishing it requires the unmodified
published 2.5.24 crate, a locked WebAssembly build, an isolated npm-tarball
installation, and the Node and browser checks below.

The update carries two fixes:

- Script/style elements are hidden by default, and ordinary `display:none`
  descendants stay hidden in flattened paragraphs, lists, captions, and cells.
  Author CSS can deliberately display source; `display:revert` restores the
  default display value.
- `text-decoration-thickness: from-font` uses the selected font's preferred
  thickness. Bundled Inter at 40px specifies 2.051pt; the previous engine used
  the automatic 3pt stroke.

The [94 visible-content pairs](../test/fixtures/hidden-text-2.5.24.json) retain
control PDFs and finalized-preview expectations from the installed core
candidate. The published npm 0.5.0 package reproduces 77 affected pairs in each
Node isolation mode while preserving all control outputs.

The [24 decoration fixtures](../test/fixtures/decoration-thickness.json) cover
underlines, overlines, strike-throughs, and combinations at two sizes. fontTools
reads the bundled font's OpenType metrics, and pypdf measures emitted colored
stroke widths. The npm 0.5.0 negative control retains eight affected cases and
40 passing explicit-length, automatic, and small-text controls across both
isolation modes.

From a built checkout with verifier dependencies installed:

```sh
npm run verify:pack
node tools/render-hidden-text.mjs
python tools/verify-hidden-text.py
node tools/render-engine-regressions.mjs
python tools/verify-engine-regressions.py
npm run verify:native
npm run verify:browser:prepare
python tools/check-browser.py --browser chrome --label candidate
python tools/verify-hidden-text.py output/browser-chrome-candidate --browser
python tools/verify-engine-regressions.py output/browser-chrome-candidate --browser
```

CI repeats the browser download checks in Chrome, Firefox, and WebKit. Use a
fresh output directory for each retained run. The Node render tools accept
`--package-root` and `--out` for a separate installation. To reproduce the old
package's defects, use `render-hidden-text.mjs --negative-control`, or render
engine regressions with `--decoration-only` and verify them with
`verify-engine-regressions.py --negative-decoration-control`.

The publication gate requires both Windows and Linux evidence for the complete
fixture sets, all three browser reports, and native/WASI comparisons for every
source and control. It rejects stale fixture hashes, a different tarball,
negative-control reports, and incomplete coverage.

Independent PDFium source/control pixels are compared within each platform.
These checks do not claim identical PDFium rasterization across operating
systems, general browser pixel parity, or PDF standards conformance.
