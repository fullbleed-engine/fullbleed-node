# A Fullbleed invoice Worker

Send structured invoice JSON and receive a styled PDF attachment. This starter
uses `fullbleed/cloudflare` with a fixed, editable component template, bundled
fonts, integer-cent totals, and flowing tables. It stores no invoices or PDFs.
Northstar Studio and the sample customer are fictional.

## Run locally

Use Node.js 22 or newer:

```sh
npm install
npm test
npm run build
npm run dev
```

In a second terminal:

```sh
curl --fail-with-body http://127.0.0.1:8787/invoice \
  -H "Content-Type: application/json" \
  --data-binary @sample.json --output invoice.pdf
npm run test:worker
```

In Windows PowerShell, use `curl.exe` and place the command on one line.
`test:worker` submits synthetic invoices and retains PDFs under `output/`.
Set `FULLBLEED_WORKER_URL` to change the local test address.

## Change the design

- `src/document.mjs`: text, function components, fields, and table rows.
- `src/styles.mjs`: page size, margins, colors, typography, and class rules.
- `src/handler.mjs`: request schema, response headers, and validation limits.
- `src/index.mjs`: the Workers adapter import.

`className` connects a component to a rule in the document's `StyleSheet`.
`Invoice({ data }).renderPdf(renderPdf)` passes both generated HTML and CSS.
For a browser HTML export, use `.toHtml({ includeStyles: true })`. You can also
replace the component template with your own HTML/CSS and call `renderPdf`.

The sample accepts 1–30 rows, 32 KiB of JSON, dates in `YYYY-MM-DD` format,
nonnegative integer-cent rates, integer quantities, and totals up to $999,999.99.
PDFs have a 10-page limit. Change these bounds alongside representative layout
tests. The template uses USD and does not calculate tax. Invoice identifiers are
restricted to safe filename characters. Text is escaped by the component API.

## Connect it to an application

The configuration disables public Workers and preview URLs and includes no
route. The local endpoint has no authentication. Before providing an external
route, add your application's authentication, authorization and rate limits;
or call it through a private Worker service binding. Keep real invoices out of
logs. `npm run build` bundles locally and does not deploy anything.

Rendering runs synchronously inside an isolate and returns a settled Promise.
The SDK does not expose cancellation or a timeout for Workers. Page and input
limits do not bound CPU time or memory. Local workerd checks are retained in the
SDK repository; hosted CPU, memory, startup and free-plan suitability have not
been qualified. Measure your real documents against
[Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/)
before choosing deployment settings.

See the [adapter guide](https://github.com/fullbleed-engine/fullbleed-node/blob/main/docs/cloudflare.md)
for custom assets, fonts, options and the supported execution model.
