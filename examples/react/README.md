# Fullbleed React PDF starter

A React and TypeScript application with a component-authored invoice, automatic
PDF previews, cancellation, and downloads. Change the customer, line items,
color or payment status and the actual PDF updates after a short pause. The
print template uses typed functions, props, mapped rows, conditional content and
attached styles. All sample data is fictional. MIT licensed.

## Run

Use Node.js 22.12 or newer for development and builds:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. The browser loads the engine and fonts
from that server and renders in a Web Worker. This app does not upload document
inputs to a PDF service. Changes last until reload or closing the editor.
Turn off **Update automatically** to render only when you choose **Generate PDF**.

## Connect your data

`src/App.tsx` holds the React form and preview UI. `src/documents/Invoice.tsx`
builds the document with Fullbleed components. Its `@jsxImportSource fullbleed/ui`
pragma selects the print JSX runtime for that file; the web UI still uses React.
Call `Invoice({ data, ink })` to compose a document and pass it to the preview
hook. Use ordinary functions for reusable print pieces. React hooks belong in
the UI, outside these synchronous document functions.

`src/documents/data.ts` defines the data, integer-cents formatting and form
validation. The demo accepts up to 20 line items and whole hours; negative rates
create credits. `src/documents/invoiceStyles.ts` holds reusable print styles,
composed with the chosen ink color. Supply your own dates and records when
building an application. Text is escaped by the component authoring layer.

Edit either print source file while Vite is running to update the PDF. The Vite
config excludes `src/documents/` from React Fast Refresh so print-component and
style changes propagate to the React form. See the React plugin's
[exclude option](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#exclude).

The design selector also includes the existing HTML/CSS invoice and three-page
report. These have an **Edit the HTML & CSS** panel and keep edits until reload.
Their source files remain `src/invoice.html`, `src/invoice.css`, `src/report.html`
and `src/report.css`. Open `?design=invoice` or `?design=report` for a direct link.
See [supported print CSS](https://docs.fullbleed.dev/css-coverage/) for layout features.

## Reuse the hook

Copy `src/usePdfPreview.ts` and the `src/documents/` directory into your client application, install
`fullbleed@0.7.1`, and copy the runtime with
`npx fullbleed-browser-assets public/fullbleed`. Keep the document input stable
with `useMemo` so ordinary component updates do not schedule another render:

```tsx
import { useMemo } from 'react';
import { usePdfPreview } from './usePdfPreview';
import { Invoice } from './documents/Invoice';
import type { InvoiceData } from './documents/data';

export function DocumentPreview({ data }: { data: InvoiceData }) {
  const input = useMemo(() => ({
    document: Invoice({ data }), previewDpi: 96, maxPages: 20, timeoutMs: 30_000,
  }), [data]);
  const pdf = usePdfPreview(input, '/fullbleed/');
  return <section>
    <button onClick={() => { void pdf.generate(); }}>Generate PDF</button>
    <button onClick={pdf.cancel}>Cancel</button>
    <p role="status">{pdf.error?.message ?? pdf.status}</p>
    {pdf.result && <>
      <a href={pdf.result.url} download="document.pdf">Download PDF</a>
      {pdf.result.previews.map((url, index) =>
        <img key={url} src={url} alt={`PDF page ${index + 1}`} />)}
    </>}
  </section>;
}
```

The hook schedules a preview after 450 ms without input changes. Use its third
argument `{ auto: false }` for on-demand generation, or `{ delayMs: 800 }` for a
longer pause. Cancel stops a pending timer or active job until the next input
change or `generate()` call. Changing preview mode also resets its output.
Pass `null` while inputs are invalid to clear old output without starting a
worker. The hook also accepts `{ html, css, ...options }` for existing templates.

It hides stale downloads immediately, aborts superseded work, ignores obsolete
results, and revokes replaced Blob URLs. Unmounting aborts the active request and
releases all output URLs. The example runs inside React `StrictMode`, including
its extra development setup/cleanup cycle. See React's guidance on
[Effect cleanup](https://react.dev/reference/react/useEffect#connecting-to-an-external-system).
Keep the hook in a client component; it depends on browser APIs.

Each hook owns one active worker handle. Multiple mounted components can still
render concurrently, so bound them for your target devices. Browser worker
termination does not provide a native thread-exit promise. The
[browser SDK guide](https://github.com/fullbleed-engine/fullbleed-node/blob/main/docs/browser.md)
covers limits, custom font/image bytes, hosting policy, and structured errors.

## Build and deploy

```sh
npm run build
npm run preview
```

Deploy the entire `dist/` directory to a static HTTPS host. Relative asset paths
support nested deployment URLs. The asset-copy step verifies the installed
client, worker, engine, fonts, build manifest, and notices; deploy them together.
The deployed site needs no Node server. HTTPS or localhost, Web Workers,
WebAssembly, and Web Crypto are required.

## Versions and verification

The lockfile pins Fullbleed 0.7.1 / engine 2.5.29, React 19.3.0, TypeScript 7.0.2,
and Vite 8.3.2. No Fullbleed engine or package release is needed for this example.

The repository's `React starter` workflow builds the locked project and checks
real PDF downloads with an independent reader. Six component cases cover the
default invoice, paid state, edited text/color, empty items, a credit and twenty
rows across three pages. Their PDFs and every preview match the installed Node
package. The existing HTML invoice and report also keep their output checks.
The workflow checks mobile layout, input races, cancellation, editing, recovery,
and unmount/remount, and records
worker API handles and Blob URL cleanup. A separate React development build
checks the same flow with StrictMode enabled. A real Vite development-server
check edits print TSX and stylesheet files, verifies the resulting PDFs, and
checks that form values survive the updates. Checks run in Chrome, Firefox and
Playwright WebKit; WebKit testing is not branded Safari certification.

This is ordinary PDF generation and preview rendering. PDF/A, PDF/UA, PDF/X and
VDP options are not exposed by this browser entry.
