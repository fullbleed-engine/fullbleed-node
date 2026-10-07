# Inline wrapping and spacing

Fullbleed for JavaScript 0.3.1 uses engine 2.5.10. It fixes overlapping text in
paragraphs such as `Edit <code>print.css</code> to change the paper size...`.
Styled words and the following text share the available line width, with
collapsed spaces handled at line edges. Built-in proportional fonts use their
actual advances instead of approximate monospace widths.

Intrinsic sizing includes fragment-edge spacing and layout rounding, so tracked
flex and inline-block labels fit their own max-content widths. Min-content
sizing recognizes collapsed-space word boundaries. The designed invoice and
report keep their footer labels on one line; their exact reviewed layout is
checked separately from the five unchanged font-only specimens.

Affected PDFs can change line breaks, pagination, and hashes. Review saved
baselines when upgrading. This correction covers space-separated, horizontal,
left-to-right text with collapsed whitespace. It does not establish complete
CSS inline conformance. The existing bidi, vertical, preserved-whitespace,
and no-wrap paths remain separate.

## Reproduce the checks

After the normal source build and tarball installation check:

```sh
npm run verify:pack
npm run render:inline
npm run verify:inline
```

The independent verifier needs the development packages pinned in
[CI](../.github/workflows/ci.yml): `pypdf`, `pypdfium2`, and Pillow. These are not
runtime dependencies of the npm package.

The suite renders twelve narrow paragraphs through both Node isolation modes,
using the package installed from its actual npm tarball. Cases cover plain text,
spans, code, color, backgrounds, padding, a second embedded font, a long styled
run, repeated spaces, Helvetica, and Times. It checks single-copy text with two
independent readers, per-word bounds, line order, content margins, second-font
selection, repeat PDF bytes, and whole-string spacing controls. Worker and
process results must have identical PDF and preview bytes.

The same twelve inputs also run through the native adapter and the browser
package checks in Chrome, Firefox, and Playwright WebKit. Browser downloads must
match the installed Node package. WebKit testing is not branded Safari testing.

The explicit, unembedded Helvetica and Times fixtures produce readable PDFs in
the independent reader, but their Fullbleed previews omit the text in both
0.3.0 and 0.3.1. Version 0.3.2 fixes these previews with bundled outline
substitutes. Every fixture now requires visible text and exact native/Wasm
preview bytes, alongside the independent PDFium layout checks. See the
[Standard 14 preview checks](standard-font-previews.md) for the public negative
control, font coverage, and upgrade behavior.

The scripts retain PDFs, native previews, independent PDFium previews, word
coordinates, input HTML/CSS, hashes, and result JSON under
`output/inline-wrapping`. CI uploads that evidence before publication. The
[GitHub release](https://github.com/fullbleed-engine/fullbleed-node/releases/tag/v0.3.1)
retains the release artifact and verification record.

Public 0.3.0 is the negative control: the same verifier rejects twenty styled
cases across the two Node modes while its four plain controls pass. This is
focused regression evidence. It does not establish PDF standards conformance
or resolve the separate native runtime investigation in
[issue #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7).
