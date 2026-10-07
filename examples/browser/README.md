# Fullbleed browser starter

A complete static web application: editable HTML/CSS templates, a designed invoice
and three-page report, local PDF/PNG rendering, cancellation, and downloads.
The sample records and amounts are fictional. MIT licensed.

## Run

Use Node.js 22.12 or newer for installation and builds:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. The first preview loads the engine and
fonts from that server. Each render runs in a fresh Web Worker; the starter does
not upload document inputs to a PDF service. Nothing persists after a reload.

## Make your template

Change the invoice fields, or open **Edit the HTML & CSS** below the preview.
Edits in that editor last until reload. To keep them in the project, edit:

- `src/invoice.html` and `src/invoice.css`
- `src/report.html` and `src/report.css`

Invoice HTML uses `{{customer}}` and `{{reference}}`; print CSS uses `{{ink}}`.
`src/main.js` replaces these values, escapes text, bounds rendering, handles
errors, and releases old PDF/preview Blob URLs. The sample line items, totals,
addresses, and dates are fixed. Add your own structured data and calculations
when adapting it for real documents.

Use [supported Fullbleed print CSS](https://docs.fullbleed.dev/css-coverage/).
Document scripts do not run. Supply custom image/font bytes through the SDK's
`assets` and `fonts` options; document URLs do not trigger browser fetches.

## Build and deploy

```sh
npm run build
npm run preview
```

Deploy the whole `dist/` directory to a static host over HTTPS. It needs no Node
server. The build uses relative URLs and supports a nested deployment path.
The asset-copy step verifies and copies the installed client, worker, engine,
fonts, build manifest, and notices. Keep those files together when deploying;
repeat the build after a package upgrade.

Browsers need Web Workers, WebAssembly, and Web Crypto. Local development works
on localhost; production needs HTTPS. The starter renders one job at a time,
with a 30-second deadline and 20-page limit. It exposes ordinary PDF generation
and previews, not PDF/A, PDF/UA, PDF/X, or VDP options.

The [browser API and hosting guide](https://github.com/fullbleed-engine/fullbleed-node/blob/main/docs/browser.md)
explains CSP, custom assets, structured errors, and browser worker lifecycle limits.

## Versions and verification

The lockfile pins Fullbleed npm 0.3.2 / engine 2.5.11 and Vite 8.3.2.
The browser SDK is covered by the [versioned release evidence](https://github.com/fullbleed-engine/fullbleed-node/releases/tag/v0.3.2).
The repository's starter check builds this app, serves it below `/nested/demo/`,
downloads actual PDFs, checks their text and page size, exercises editing and
cancellation, and captures desktop/mobile screenshots. Playwright WebKit is not
branded Safari certification.

See the [public walkthrough](https://docs.fullbleed.dev/guides/browser-pdf/) or
the [source repository](https://github.com/fullbleed-engine/fullbleed-node/tree/main/examples/browser).
