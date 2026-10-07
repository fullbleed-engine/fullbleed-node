# Standard 14 font previews

Fullbleed for JavaScript 0.3.2 uses engine 2.5.11. It fixes blank PNG previews
when HTML/CSS selects an unembedded Standard 14 face. The preview renderer
contains fixed OFL outline substitutes and needs no host fonts or font download.
Explicitly registered and embedded fonts retain precedence.

```javascript
const result = await renderPdf({
  html: '<p>Invoice INV-1042</p>',
  css: 'p { font-family: Helvetica; font-size: 20pt }',
  previewDpi: 96,
});
```

This applies to the Node worker/process modes and the separate browser entry.
Review preview baselines when upgrading. The substitutes preserve PDF text,
font resources, and advances; the preview uses substitute designs. Register
your chosen font files for a specific branded appearance across PDF readers.

## Release checks

`npm run render:standard` renders all twelve Latin faces (Helvetica, Times, and
Courier with their bold/italic variants) and an embedded Inter control from the
isolated npm tarball in both Node modes. `npm run verify:standard` checks their
text and selected fonts with independent PDF readers, checks visible preview
ink, and retains the PDF, native PNG, and PDFium PNG.

The public 0.3.1 negative control produces 24 blank Standard 14 previews and two
visible Inter controls. Comparison with that control requires all 26 PDFs to
remain byte-identical and both Inter previews to remain byte-identical. The
native adapter requires exact PDF and preview bytes for all 32 fixtures. The
same thirteen new inputs also run through the browser package in Chrome,
Firefox, and Playwright WebKit; their downloads must match the installed Node
package. WebKit testing does not establish branded Safari support.

CI retains these checks under `output/standard-fonts`, `output/standard-baseline`,
and the existing native/browser evidence folders. The release gate requires
105 checks in each browser, all nine Node/platform installation jobs, and the
source/native build job before publication.

The engine's [font provenance and coverage limits](https://github.com/fullbleed-engine/fullbleed-official/blob/v2.5.11/src/preview_fonts/README.md)
cover Symbol and Dingbats as well. This JavaScript HTML/CSS fixture set verifies
the twelve Latin faces. Complete font licenses ship in
`dist/preview-font-notices/` and `dist/THIRD_PARTY_NOTICES.txt`; the latter is
copied into browser deployments. These checks are scoped regression evidence,
with no general PDF conformance or original-font-design parity claim.
