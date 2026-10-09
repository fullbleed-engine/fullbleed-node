# Checking the installed package's embedded fonts

Node package 0.1.4 introduced the Fullbleed 2.5.7 font compaction described here;
0.4.1 retains these checks with engine 2.5.22. The engine's font subsetting
removes unused metadata and metrics while retaining original glyph IDs and the
glyph outlines, instructions, advances, character mappings, and font notices
needed by the document. The JavaScript API and four bundled font faces are
unchanged.

The release gate renders seven synthetic fixtures twice through a separate npm
installation: the designed invoice, three-page report, each of the four bundled
font faces, and a custom Noto Sans Math font with a supplementary-plane character.
The four bundled faces are Inter, DM Serif Display regular and italic, and Bebas
Neue. The additional test font is not included in the npm package.

`tools/verify-font-subsets.py` independently checks the PDFs with pypdf, PDFium,
and fonttools. It checks the embedded programs against the original font bytes,
including composite components, checksums, notices, compact `post` tables,
horizontal metrics, and header extrema. Both readers must extract the same text.
The repeated PDFs must be byte-identical. In the comparison with 0.1.3, all seven
PDFs must be smaller and retain their normalized text and page counts. The five
font-only specimens must also retain exact text, native previews, and PDFium
page pixels. The invoice and report match the unchanged, reviewed 2.5.22 layout in
[`test/fixtures/inline-layout-2.5.22.json`](../test/fixtures/inline-layout-2.5.22.json),
including PDF hashes. Their tracked labels and footers stay on one line after
the inline-sizing correction. Reports explicitly record that these two layouts
differ from 0.1.3; they do not report unchanged pixels. Source HTML/CSS and font
bytes must still match the historical fixtures. These checks establish behavior for the retained fixtures;
they are not a general visual-parity, speed, or PDF conformance claim.

After building and running `npm run verify:pack`, install the development-only
readers and reproduce the comparison:

```bash
python -m pip install pypdf==6.19.0 pypdfium2==5.14.0 fonttools==4.65.0 pillow==12.3.0
npm install --prefix output/font-baseline-consumer --ignore-scripts --no-audit --no-fund --save-exact fullbleed@0.1.3
npm run render:fonts -- --package-root output/font-baseline-consumer/node_modules/fullbleed --out output/font-baseline
npm run verify:fonts -- --evidence-root output/font-baseline --allow-legacy-metadata
npm run render:fonts
npm run verify:fonts -- --baseline output/font-baseline --reviewed-layout test/fixtures/inline-layout-2.5.22.json
```

The legacy flag applies only to the old package's metadata; outlines, metrics,
notices, checksums, and text must still pass. Omitting it when checking the old
release provides a negative control: the compact-metadata gate must reject it.

The renderer refuses to overwrite an evidence directory. Preserve completed
runs and choose a new `--out` path when repeating a check. Reports, exact HTML/CSS,
source fonts and licenses, PDFs, and native/PDFium previews are retained under
`output/font-baseline` and `output/font-subsets`. The CI evidence artifact includes
both directories and the baseline's npm lockfile; release verification binds the
candidate tarball to all thirteen CI jobs, including three browser checks.

Python and these readers are verification tools only. Installing or running the
npm package requires none of them. The separate [Node 24 crash investigation](runtime-diagnostics.md)
remains open; this engine update does not establish a fix for that intermittent
native process crash.

For the retained 0.1.4 comparison against npm 0.1.3, the designed invoice changes
from 91,590 to 40,289 bytes (56.0% smaller), and the three-page report changes from
94,529 to 46,259 bytes (51.1% smaller). Both keep identical text and page pixels.
The [release evidence](https://github.com/fullbleed-engine/fullbleed-node/releases/tag/v0.1.4)
contains all seven before/after records, source inputs, PDFs, and previews. File
size savings depend on each document and its fonts.
