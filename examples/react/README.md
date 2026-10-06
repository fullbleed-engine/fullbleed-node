# Fullbleed React PDF starter

A React and TypeScript application with automatic PDF previews, editable HTML/CSS
templates, cancellation, and downloads. Change a form field and the actual PDF
updates after a short pause. Includes a designed invoice and three-page report;
all sample organizations, records, and amounts are fictional. MIT licensed.

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

`src/App.tsx` holds the React form, templates, and preview UI. The invoice uses
`{{customer}}` and `{{reference}}` in HTML and `{{ink}}` in CSS. The app escapes
customer text before filling the template and accepts a six-digit hex ink color.
Replace the fixed line items, totals, addresses, and dates with your data and
calculations when building a real application.

Use **Edit the HTML & CSS** to try another layout. To keep it, edit the matching
`src/invoice.html`, `src/invoice.css`, `src/report.html`, or `src/report.css` file.
Use [supported print CSS](https://docs.fullbleed.dev/css-coverage/); the engine
renders supplied static HTML/CSS rather than capturing the React page.

## Reuse the hook

Copy `src/usePdfPreview.ts` into your client application, install
`fullbleed@0.3.0`, and copy the runtime with
`npx fullbleed-browser-assets public/fullbleed`. Keep the document input stable
with `useMemo` so ordinary component updates do not schedule another render:

```tsx
import { useMemo } from 'react';
import { usePdfPreview } from './usePdfPreview';

export function DocumentPreview({ html, css }: { html: string; css: string }) {
  const input = useMemo(() => ({
    html, css, previewDpi: 96, maxPages: 20, timeoutMs: 30_000,
  }), [html, css]);
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

The lockfile pins Fullbleed 0.3.0 / engine 2.5.8, React 19.3.0, TypeScript 7.0.2,
and Vite 8.3.2. No Fullbleed engine or package release is needed for this example.

The repository's `React starter` workflow builds the locked project and checks
real PDF downloads with an independent reader. It compares default invoice and
report PDF bytes with the installed Node package, checks mobile layout, exercises
input races, cancellation, editing, recovery, and unmount/remount, and records
worker API handles and Blob URL cleanup. A separate React development build
checks the same flow with StrictMode enabled. Checks run in Chrome, Firefox and
Playwright WebKit; WebKit testing is not branded Safari certification.

This is ordinary PDF generation and preview rendering. PDF/A, PDF/UA, PDF/X and
VDP options are not exposed by this browser entry.
