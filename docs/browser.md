# Generate PDFs in a browser

The `fullbleed/browser` entry in Fullbleed 0.3.1 renders static HTML/CSS in a
dedicated Web Worker. It uses the same pinned 2.5.10 engine and bundled fonts as
the Node entry. The result is a `Uint8Array`, suitable for a PDF `Blob`, plus
optional PNG previews. No PDF server or account is required.

The [runnable browser starter](../examples/browser) includes editable templates,
previews, downloads, and production build settings.
The [React and TypeScript starter](../examples/react) adds form-driven automatic
previews and a reusable hook that cancels stale work and releases output URLs
when inputs change or the component unmounts.

## Copy the runtime into your site

Install the package in your web project, then copy its browser files into the
directory your application serves as static files:

```sh
npm install --save-exact fullbleed@0.3.1
npx fullbleed-browser-assets public/fullbleed
```

The command verifies the installed files before writing the client, worker,
WebAssembly engine, fonts, build manifest and license notices. It replaces the
named runtime files in the output directory. Keep the complete directory when
deploying, and repeat the copy after upgrading the package. Node is needed for
this installation/build step, not by the deployed static site.

Serve the directory over HTTPS or localhost. The browser API needs Web Workers,
WebAssembly and Web Crypto. The asset URL must be on the same origin, end in `/`,
and contain no credentials, query or fragment. If your application uses a URL
prefix, include it: `/my-app/fullbleed/`.

## Render and download

In your application's browser code:

```js
import { createRenderer } from 'fullbleed/browser';

const renderer = createRenderer({ assetBaseUrl: '/fullbleed/' });

document.querySelector('#download').addEventListener('click', async () => {
  const result = await renderer.renderPdf({
    html: '<h1>Invoice NS-1042</h1><p>Consulting: USD 1,200.00</p>',
    css: '@page { size: A4; margin: 20mm } h1 { color: #175c52 }',
    maxPages: 20,
    previewDpi: 96,
  });
  const url = URL.createObjectURL(new Blob([result.pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'invoice.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
```

Add a `<button id="download">Download invoice</button>` to the page. Catch errors
in your application and show a useful status beside the button. Escape customer
and other data before inserting it into a template.

Without a bundler, import the copied module from `/fullbleed/client.js` in an
external JavaScript module loaded with `<script type="module" src="app.js">`.
Both entry points use the same built client. The copied worker contains its
runtime dependencies, so it does not need an import map or a CDN.

Creating the renderer does not start a worker or load its engine. Each call starts
a fresh worker, loads and verifies the engine/font bytes, and renders the
document off the page's JavaScript thread. Normal browser HTTP caching can reuse
the static files according to your server's headers. There is no persistent
renderer pool or offline-service-worker installation.

## Inputs, limits and errors

`renderer.renderPdf(options)` returns `{ pdf, previews, pages, missingGlyphs,
engineVersion }`. `pdf` and each preview are byte arrays backed by ordinary
`ArrayBuffer` objects. A preview can be displayed with an `image/png` Blob URL;
release those URLs when replacing a preview or unmounting the component.

Options are `html`, `css`, `fonts`, `assets`, `previewDpi`, `timeoutMs`, `maxPages`,
`allowMissingGlyphs` and `signal`. They follow the [Node input rules](../README.md#api):
4,000,000 UTF-8 bytes of HTML/CSS, 64 MiB of supplied fonts/assets, previews at
36–300 DPI or disabled, a default 30-second deadline and 1,000-page limit.
The browser entry rejects Node's `isolation` option. Browser TypeScript declarations
use DOM types and require TypeScript 5.7 or newer; no Node types are needed.

```js
import { FullbleedError } from 'fullbleed/browser';

const controller = new AbortController();
// Connect a Cancel button to controller.abort().
try {
  const result = await renderer.renderPdf({
    html: '<h1>Monthly report</h1>',
    signal: controller.signal,
    timeoutMs: 10_000,
    maxPages: 20,
  });
} catch (error) {
  if (error instanceof FullbleedError) console.error(error.code, error.message);
  else throw error;
}
```

The deadline includes worker startup and runtime-file loading. Success, errors,
timeouts and aborts call the browser's `Worker.terminate()` API before the promise
settles. Unlike Node workers, browser workers expose no thread-exit promise; the
browser controls reclamation. A failed call returns no partial PDF, and a later
call starts a new worker. Bound concurrent calls for the target devices: each
WebAssembly instance has a 512 MiB ceiling, and previews need additional memory.

`FullbleedError.code` includes `INVALID_INPUT`, `UNSUPPORTED_BROWSER`,
`VERSION_MISMATCH`, `WORKER_FAILED`, `ENGINE_LOAD_FAILED`, `MISSING_GLYPHS`,
`PAGE_LIMIT`, `TIMEOUT`, `ABORTED`, `ENGINE_LIMIT`, `RENDER_FAILED` and
`PREVIEW_FAILED`. Version mismatch means the installed client and hosted worker
must be deployed together. Engine-load errors can indicate missing or changed
files, blocked requests or a content security policy that prevents WebAssembly.

## Hosting and document scope

For the tested static fixture, this content security policy allows the external
JavaScript modules, same-origin worker/runtime files and Blob previews:

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'
```

Adapt it to the rest of your application and apply an appropriate policy to the
worker response too. The
[WebAssembly CSP permission](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution)
is narrower than enabling JavaScript `eval`.

The SDK sends document inputs to the same-origin worker by `postMessage`; it
does not upload them to a rendering service. The worker fetches the shipped
engine and font assets, with credentials omitted, then uses an in-memory
filesystem. Supply document images and extra fonts as byte arrays through
`assets` and `fonts`. URLs in document HTML/CSS are not browser network requests,
and document scripts are not executed.

Use the [supported print CSS](https://docs.fullbleed.dev/css-coverage/), not an
arbitrary application DOM or live-page screenshot. This entry covers ordinary
PDF generation and previews; it does not expose PDF/A, PDF/UA, PDF/X or VDP.

## Verification

`tools/check-browser.py` exercises the copied files from an isolated installation
of the npm tarball. Chrome, Firefox and Playwright WebKit render an invoice,
three-page report, a custom font/SVG fixture and static document content. The
PDF and PNG bytes are compared to the installed Node package; an independent
PDF reader checks each page's text. The suite also checks buffer snapshots,
structured errors, cancellation during worker construction and asset fetching,
timeouts, mismatched workers, corrupted/missing engine files and recovery.

The page's WebAssembly entry points are disabled during the check to establish
that rendering occurs in the worker. Network observations cover same-origin GETs
without document uploads in those fixtures. Termination instrumentation observes
calls to the browser API, not OS thread-exit events. Playwright WebKit testing is
not a branded Safari certification. Retain the final version-specific results
with each release; do not infer compatibility with untested devices or policies.
