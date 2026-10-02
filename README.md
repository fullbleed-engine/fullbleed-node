# Fullbleed for Node.js

Generate PDFs from static HTML and CSS in Node.js. The package includes the
Fullbleed Rust engine compiled to WebAssembly and four font faces, so installing
it does not require Python, Rust, a browser, or system fonts. MIT licensed.

This is an optional integration around the unchanged **Fullbleed 2.5.4** engine.
The Node package has its own version, **0.1.0**.

## Install and render

Use Node.js 22 or newer. Install the versioned package from its GitHub release:

```bash
npm install https://github.com/fullbleed-engine/fullbleed-node/releases/download/v0.1.0/fullbleed-0.1.0.tgz
```

Save this as `invoice.mjs` and run `node invoice.mjs`:

```javascript
import { writeFile } from 'node:fs/promises';
import { renderPdf } from 'fullbleed';

const result = await renderPdf({
  html: '<h1>Invoice NS-1042</h1><p>Consulting: USD 1,200.00</p>',
  css: '@page { size: A4; margin: 20mm } h1 { color: #175c52 }',
  previewDpi: 96,
});

await writeFile('invoice.pdf', result.pdf);
await writeFile('invoice.png', result.previews[0]);
console.log(`${result.pages} page; engine ${result.engineVersion}`);
```

Inter is the default font. CommonJS also works:
`const { renderPdf } = require('fullbleed')`. TypeScript declarations are included.

[Try the browser playground](https://docs.fullbleed.dev/playground/) ·
[Fullbleed documentation](https://docs.fullbleed.dev/) ·
[CSS coverage](https://docs.fullbleed.dev/css-coverage/) ·
[Python and Rust engine](https://github.com/fullbleed-engine/fullbleed-official)

## A designed invoice

![Northstar invoice with cream paper, serif typography, green tables, and an orange accent.](https://docs.fullbleed.dev/assets/showcase/invoice-1.png)

The [runnable example](examples/invoice.mjs) uses these same invoice sources and
the bundled Inter, DM Serif Display, and Bebas Neue families. It escapes the
customer name before inserting it into HTML. The data is fictional.

From a source checkout, after the build steps below:

```bash
npm run example
```

Open `output/invoice/invoice.pdf` and `page-1.png`. The [three-page report
sources](examples/report.html) demonstrate pagination, tables, and vector artwork.

## Fonts and assets

Supply file bytes explicitly. Additional fonts are registered alongside the
bundled fonts; use their actual family names in CSS. Asset names are relative to
the virtual `assets/` directory:

```javascript
import { readFile } from 'node:fs/promises';
import { renderPdf } from 'fullbleed';

const result = await renderPdf({
  html: '<img src="assets/brand/logo.svg"><h1>Quarterly report</h1>',
  css: "body { font-family: 'Your Font Family', Inter } img { width: 80pt }",
  fonts: [await readFile('your-font.ttf')],
  assets: { 'brand/logo.svg': await readFile('logo.svg') },
});
```

The WebAssembly engine sees an in-memory filesystem containing the supplied
inputs and bundled fonts. It does not fetch remote URLs or read application files.
Use the asset map or data URIs for document images. Render and review previews
when adapting a template; unsupported CSS or an unavailable asset can affect output.

Use registered font families in CSS. The engine can substitute an unavailable
family. Its missing-glyph report checks resolved fonts and is not an exhaustive
font-substitution or visual-validation report.

## API

`await renderPdf(options)` returns `{ pdf, previews, pages, missingGlyphs,
engineVersion }`. PDF and PNG values are Node `Buffer` objects. Previews are
generated from the finalized PDF and are empty when disabled.

Linear-gradient fills can appear in the PDF but be absent from PNG previews in
this engine version. The report example uses solid chart fills for that reason.

| Option | Behavior |
| --- | --- |
| `html` | Required nonempty HTML string. |
| `css` | CSS string; defaults to empty. The default Inter rule precedes it. |
| `fonts` | Additional TrueType font bytes as `Uint8Array[]` or `Buffer[]`. |
| `assets` | Map relative asset names to nonempty byte arrays. |
| `previewDpi` | `0` disables previews; otherwise an integer from 36 to 300. |
| `maxPages` | Reject larger documents. Default: 1000. |
| `timeoutMs` | Deadline including initial engine loading. Default: 30000 ms. |
| `signal` | An `AbortSignal` to cancel rendering. |
| `allowMissingGlyphs` | Default `false`: reject engine-reported missing glyphs. |

Rendering runs in a dedicated worker. Concurrent calls use separate workers and
document state. Bound concurrency in a server according to its available memory;
each worker's WebAssembly memory has a 512 MiB ceiling. HTML and CSS together are
limited to 4,000,000 UTF-8 bytes; supplied fonts and assets together to 64 MiB.
Preview images can use substantially more memory than PDF-only rendering.

```javascript
import { FullbleedError, renderPdf } from 'fullbleed';

try {
  const result = await renderPdf({
    html: '<h1>Monthly statement</h1>',
    maxPages: 20,
    timeoutMs: 10_000,
    signal: AbortSignal.timeout(8_000),
  });
  // Return result.pdf from your HTTP handler, or write it to your storage.
} catch (error) {
  if (error instanceof FullbleedError) console.error(error.code, error.message);
  else throw error;
}
```

Error codes include `INVALID_INPUT`, `MISSING_GLYPHS`, `PAGE_LIMIT`, `TIMEOUT`,
`ABORTED`, `ENGINE_LOAD_FAILED`, `ENGINE_LIMIT`, `RENDER_FAILED`,
`PREVIEW_FAILED`, and `WORKER_FAILED`. Failed or cancelled calls do not return a
partial PDF. Caller-owned asset buffers are copied when a call starts.

This API covers ordinary document generation and previews. It does not expose
PDF/A, PDF/UA, PDF/X, template overlays, or compiled VDP. Use the
[Python or Rust APIs](https://docs.fullbleed.dev/) for those workflows and their
verification requirements. Unknown options are rejected. Fullbleed uses static
HTML/CSS for print layout; it does not execute document JavaScript or reproduce
arbitrary browser pages.

## Build and verify from source

Contributors need Node.js 22+ and Rust 1.97.0 with the WASI target. Package users
do not need a compiler. Dependencies are pinned in both lockfiles.

```bash
rustup target add wasm32-wasip1
npm ci --ignore-scripts
npm run build
npm test
npm run check:types
npm run verify:native
npm run verify:pack
```

The build records engine metadata, licenses, and artifact hashes in `dist/`.
The verification suite renders actual invoices, a three-page report, custom
fonts, and image assets; compares native and WebAssembly PDF/PNG bytes; checks
error recovery; and installs the packed tarball into a separate directory with
spaces in its path. CI exercises Node 22, 24, and 26 on Windows, Linux, and macOS.
Retained release evidence describes the verified fixtures and scope.

## License and support

The adapter and Fullbleed engine are MIT licensed. Bundled fonts use SIL OFL 1.1.
The WASI shim is used under its MIT option. Complete notices ship with the package
in `dist/THIRD_PARTY_NOTICES.txt` and `assets/fonts/`.

Report reproducible integration bugs in [this repository's
issues](https://github.com/fullbleed-engine/fullbleed-node/issues). Include the
package and Node versions, platform, minimal synthetic inputs, and error code.
For engine behavior and general usage, use the
[Fullbleed discussion forum](https://github.com/fullbleed-engine/fullbleed-official/discussions).
