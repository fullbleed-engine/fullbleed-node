# Inline wrapping and spacing

Fullbleed for JavaScript 0.3.1 uses engine 2.5.9. It fixes overlapping text in
paragraphs such as `Edit <code>print.css</code> to change the paper size...`.
Styled words and the following text share the available line width, with
collapsed spaces handled at line edges. Built-in proportional fonts use their
actual advances instead of approximate monospace widths.

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
the independent reader, but their Fullbleed native previews omit the text in
both 0.3.0 and 0.3.1. Their layout checks use PDFium. Preview equality does not
prove visual fidelity for those fonts; use the bundled or explicitly registered
fonts when requesting Fullbleed previews. Embedded-font cases must contain
visible ink, and their previews are retained for review. The native adapter can
use host-font fallback for those unembedded faces, while the Wasm package has
no host fonts. The native check retains both previews and requires PDF equality
for those two cases; it requires exact preview bytes for the other fixtures.

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
