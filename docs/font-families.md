# Regular and italic custom fonts

Node 0.1.5 uses Fullbleed 2.5.8. If you supply a family's italic face before its
regular face through `fonts`, normal text selects the regular face. Set
`font-style: italic` when italics are intended. Use explicit PostScript names or
`@font-face` mappings when the document needs a particular face. The
[engine guide](https://docs.fullbleed.dev/engine/font-registration/) describes
family defaults, exact aliases, and upgrade considerations.

The four bundled faces already registered regular before italic. The regression
check therefore uses a separate custom family, Libre Caslon Text, with both
registration orders. Its unmodified fonts, OFL license, upstream commit, and
checksums are retained under `test/fonts/family`; they are excluded from the npm
package. Ten cases cover explicit-face controls, family selection, and
`@font-face` mappings for normal and italic text.

After building and checking the actual tarball:

```sh
npm run verify:pack
npm run render:families
npm run verify:families
```

The independent verifier uses the same development-only PDF and font readers
listed in the README. It checks the embedded face and original name/notice
table, extracted text, and native/PDFium preview pixels against the explicit-face
controls. `output/font-families` retains inputs, source fonts and licenses, PDFs,
previews, and reports. Choose `--out` with `render:families` and pass that directory
to `python tools/verify-font-families.py` to preserve separate runs.

Public npm 0.1.4 is the negative control: with the same inputs, its normal-text
case with italic registered first must fail the independent face check. The
existing seven-fixture subset comparison remains pinned to its historical
0.1.3 baseline. Neither suite establishes complete CSS font matching or resolves
the separate [Node runtime investigation](runtime-diagnostics.md).
