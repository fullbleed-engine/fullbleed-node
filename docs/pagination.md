# Clipped tables across PDF pages

Fullbleed 0.8.1 pins the published 2.5.35 engine. Auto-height tables and containers
with `overflow: hidden`, `clip`, `auto`, or `scroll` can continue onto another
PDF page. Before this correction, clipping could keep later rows below the
physical page. A `height` or `max-height` constraint still creates a bounded
viewport; remove that constraint when the content should flow.

```js
import { renderPdf } from 'fullbleed';

const rows = Array.from({ length: 80 }, (_, i) =>
  `<tr><td>ROW-${i + 1}</td><td>Finding details</td></tr>`).join('');

const result = await renderPdf({
  html: `<table><thead><tr><th>Record</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody></table>`,
  css: `@page { size: A5; margin: 15mm; }
    table { width: 100%; overflow: hidden; border: 1pt solid #24554d; }
    th, td { padding: 6pt; }`,
});
```

Keep `<thead>` for repeated column headings. Check the saved PDF with your actual
fonts and data, especially when a single row is taller than the page. Text
extraction alone cannot establish that the text is visible within page bounds.

The acceptance cases cover six clipping combinations, forced page breaks,
preceding text when a footnote moves, and a fixed-height control. They run through
both Node isolation modes and through the browser package. Independent PDF checks
inspect every row, repeated headings, footnote placement, and physical glyph
bounds. Repeated rendering and worker/process output must match. Browser PDFs
must match the installed Node package and pass the same bounds checks.

The public 0.8.0 package is the negative control: eight cases fail in each Node
isolation mode, while the fixed-height case passes. The new package must pass all
eighteen cases. Existing font, paint, and styling checks remain in place.

The engine upgrade also adopts a reviewed Common Ground heading adjustment from
earlier stable releases: the name at the top of pages 2 and 3 moves down 0.75pt.
All other visible glyph positions and the other six font-fixture PDFs are
unchanged. The report is byte-identical to the published Python 2.5.34 core with
the same input and fonts. Both the old and new exact layout references are
retained under `test/fixtures/inline-layout-2.5.*.json`.

To run the installed-package checks after building and packing:

```bash
npm run verify:pack
npm run render:pagination
npm run verify:pagination
```

PDF/UA, PDF/A, and PDF/X conformance are outside this JavaScript API's current
verification scope. These pagination cases do not add a profile option.
