# Text that fits the table

Fullbleed 0.8.2 uses the published 2.5.37 engine. Narrow tables now honor natural
Japanese line breaks and Latin text using `word-break: break-all`,
`overflow-wrap: anywhere` or `line-break: anywhere`. The correction also applies
when text is inside a span or paragraph in the cell.

```js
import { readFile } from 'node:fs/promises';
import { renderPdf } from 'fullbleed';

const { pdf } = await renderPdf({
  html: '<table><tr><td>東京都の交通計画と地域調査の結果を説明する日本語の文章です</td></tr></table>',
  css: `
    @page { size: A4; margin: 20mm; }
    body { font-family: "BIZ UDPGothic"; font-size: 12pt; }
    table { width: 65mm; border-collapse: collapse; }
    td { padding: 3mm; border: 1pt solid #175c52; }
  `,
  fonts: [await readFile('./fonts/BIZUDPGothic-Regular.ttf')],
  defaultStyles: false,
});
```

Supply a licensed font that covers your text; the bundled Latin fonts do not
provide Japanese glyph coverage. Use its actual family name in CSS. The browser
API accepts the same document options, with font bytes loaded by your application.

For long identifiers that may break anywhere, set `overflow-wrap: anywhere` on
the cell. `overflow-wrap: break-word` does not lower the intrinsic minimum width.
Authored `white-space: nowrap`, `word-break: keep-all`, unbreakable text and
explicit child `width`/`min-width` remain respected; they can require a wider table.

## Verification

The package checks retain 35 cases from the core's reviewed regression suite:
Japanese and Latin wrapping, plain/inline/block cell content, fixed table spans,
explicit and nested child widths, border-box sizing and percentage controls.
They render through both Node isolation modes and the browser package.

The published 0.8.1 package is the negative control: 18 cases fail and 17 pass in
each Node mode. Candidate checks require all 35 to pass, with identical PDFs,
native previews, independent PDFium pixels, text and glyph positions for the
17 healthy controls. These are fixture-specific checks, not a claim of complete
CSS compatibility.

The test-only Japanese font is a renamed, licensed subset retained with its
source and SHA-256 digests. It is not shipped as a general-purpose package font.
