# Generate PDFs in Cloudflare Workers

Import `renderPdf` from `fullbleed/cloudflare` inside a Worker. Wrangler bundles
the package's pinned WebAssembly engine and four font faces with your application.
The renderer uses an in-memory filesystem and produces PDF bytes plus optional
PNG previews. HTML/CSS and document data stay in the Worker handling the request.

This entry is checked in local `workerd` on Windows and Linux. A hosted
[Workers Playground smoke test](#hosted-playground-smoke-test) also reproduces the
invoice starter's PDFs. Production CPU, memory, startup behavior, and Free-plan
suitability still require testing in your deployment. See
[Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/).

For a complete JSON-to-PDF endpoint, use the
[invoice starter](../examples/cloudflare/). It includes an editable Northstar
component template, request limits, integer-cent totals, download headers and
local tests for normal, long, escaped and invalid invoices.

## Add it to a Worker

Use Node.js 22 or newer for your development tools:

```sh
npm install --save-exact fullbleed@0.8.7
npm install --save-dev --save-exact wrangler@4.151.3
```

Add a font module rule to your Wrangler configuration. The `.wasm` import uses
Wrangler's built-in compiled-module rule.

```json
{
  "name": "invoice-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-10-20",
  "workers_dev": false,
  "preview_urls": false,
  "rules": [{ "type": "Data", "globs": ["**/*.ttf"], "fallthrough": false }]
}
```

Save this as `src/index.js`:

```js
import { renderPdf } from 'fullbleed/cloudflare';

export default {
  async fetch() {
    const result = await renderPdf({
      html: '<h1>Invoice NS-1042</h1><p>Design and delivery: $1,870.00</p>',
      css: '@page { size: A4; margin: 20mm } h1 { color: #173b35 }',
      maxPages: 5,
    });
    return new Response(result.pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="invoice.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  },
};
```

Run `npx wrangler dev --local` and open the displayed localhost URL. No Cloudflare
account is needed for this local check. `workers_dev: false` and
`preview_urls: false` keep public preview URLs disabled if you later deploy;
configure service bindings or your application's authenticated route deliberately.

## Components and styles

The static component API works in the same Worker. A document artifact supplies
its HTML and CSS to the renderer:

```js
import { renderPdf } from 'fullbleed/cloudflare';
import { Document, Heading, Paragraph } from 'fullbleed/ui';

const doc = Document({
  title: 'Monthly statement',
  styles: {
    '@page': { size: 'A4', margin: '20mm' },
    '.balance': { color: '#173b35', fontSize: '24pt' },
  },
}, Heading({ level: 1 }, 'Monthly statement'),
   Paragraph({ className: 'balance' }, '$1,870.00'));

const result = await doc.renderPdf(renderPdf, { maxPages: 5 });
```

`className` adds an HTML class. The matching rule belongs in `styles` or the
renderer’s `css` string. Use `doc.renderPdf(renderPdf)` or pass both
`doc.toHtml()` and `doc.toCss()` for the separate HTML/CSS form.
`doc.toHtml({ includeStyles: true })` produces a complete HTML document with
its stylesheet embedded. This also renders with `css: ''` and
`defaultStyles: false`; the Workers checks compare both forms' PDF and preview
bytes. Remote stylesheets are not fetched.

## Options and execution

`renderPdf(options)` returns a Promise for `{ pdf, previews, pages,
missingGlyphs, engineVersion }`. PDF and PNG values are `Uint8Array` instances
backed by ordinary `ArrayBuffer` objects.

| Option | Workers behavior |
| --- | --- |
| `html`, `css` | Static source; at most 1,000,000 UTF-8 bytes combined. |
| `defaultStyles` | Defaults to `true`, adding the Inter body rule; `false` preserves your CSS. |
| `fonts` | Additional TrueType font byte arrays, using family names in CSS. |
| `assets` | Byte arrays under relative names; refer to `assets/name.svg` in HTML/CSS. |
| `fonts` + `assets` | At most 8 MiB combined; accepted caller buffers are snapshotted. |
| `maxPages` | Defaults to 20; exceeding the limit rejects the result. |
| `previewDpi` | Defaults to 0; 36–300 enables one PNG per page. Account for memory. |
| `allowMissingGlyphs` | Defaults to `false`; explicit opt-in retains the missing-glyph count. |

The computation is synchronous inside the isolate and returns a settled Promise.
Each call uses a fresh engine instance. Calls on the same isolate do not
interleave engine execution; this does not guarantee that previous allocations
have already been garbage-collected.

`timeoutMs`, `signal`, and `isolation` are rejected. The SDK cannot interrupt
synchronous computation from within the same isolate. Cloudflare owns CPU and
memory enforcement; a platform termination may bypass application error handling.
Set workload-appropriate platform limits, bound accepted data and concurrency in
your application, and measure representative documents in your deployed Worker.
Page and input limits are not CPU or memory guarantees.

Catch `FullbleedError` for input validation, page limits, missing glyphs, and
engine failures. A rejected call returns no partial PDF. A later call creates a
fresh instance. Document scripts do not run, and document URLs do not trigger
network fetching. Supply images and custom fonts as bytes.

This is the static print engine, not browser layout or a live-page renderer.
The entry exposes ordinary PDF generation and previews, not PDF/A, PDF/UA,
PDF/X, or VDP profiles.

## Verify the installed package

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check:types
npm run verify:pack
npm run verify:cloudflare
python tools/verify-cloudflare.py
```

The Workers check uses the isolated tarball installation. It compares PDF and
PNG bytes with Node for Northstar, Common Ground, a custom font/SVG fixture, and
component-authored documents. It exercises input budgets, unsupported controls,
asset paths, page limits, missing glyphs, repeated calls, and failure recovery.
Runtime fetching and asynchronous Wasm compilation are disabled during the check.
An independent PDF reader checks pages, expected text, and the custom font face;
PNG files are decoded separately. Evidence is retained under
`output/cloudflare-verification/`. Local checks establish local behavior only.

## Hosted Playground smoke test

On October 21, 2026 (UTC), the released `fullbleed@0.8.0` invoice starter was
bundled with its locked Wrangler version and exercised in Cloudflare's
[account-free Workers Playground](https://developers.cloudflare.com/workers/playground/).
The sample, zero-total, maximum-total, five-page, escaped-text and post-error
invoices produced exactly the same PDF bytes as the retained local fixtures.
An independent PDF reader checked all ten pages and expected text. Ten invalid
inputs returned their expected status and error code; method and route checks
also passed. The temporary preview was replaced with a `410` response afterward.

The [verification record](../verification/cloudflare-playground-0.8.0.json)
includes the uploaded module hashes, output hashes and source references. This
was a bounded sandbox smoke test. CPU and memory were not measured, and it was
not a load test or production account deployment. The Playground's
[service source at the checked revision](https://github.com/cloudflare/workers-sdk/blob/f43e2e61093b3218a48691dc76ce7f463a2123ce/packages/playground-preview-worker/src/user.do.ts#L169)
selects an `unbound` usage model, so success there does not establish Free-plan
suitability. Test your representative workloads and authenticated routes in the
account and plan you will use.
