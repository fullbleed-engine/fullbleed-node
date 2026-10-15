# Preserving a template's styles

The package normally prepends `body { font-family: Inter; }` to your CSS.
Set `defaultStyles: false` when your template should control the font cascade:

```js
const result = await renderPdf({
  html: '<html><body><p>Set in the inherited face.</p></body></html>',
  css: 'html { font-family: "DM Serif Display"; }',
  defaultStyles: false,
  previewDpi: 96,
});
```

The same option works with `isolation: 'process'`, `createRenderQueue()`, and
`createRenderer()` from `fullbleed/browser`. It must be a boolean. Queues copy
the choice when a job is submitted. Omitting it or using `true` preserves the
previous behavior. `false` removes only the package's added body rule; the
engine's built-in document defaults and bundled fonts still apply.

## Verification

[`test/fixtures/default-styles.json`](../test/fixtures/default-styles.json)
retains independent PDF and PNG hashes from the playground's Fullbleed 2.5.22
WASI renderer and the published Node 0.4.1 package. Six fixtures cover no font
rule, `html` inheritance, explicit `body`, the universal selector,
`:where(body)`, and a layered body rule. The last two cannot be repaired by
prepending a `font-family: inherit` workaround because that rule changes the
cascade.

The installed-tarball check verifies 48 renders across direct worker/process
calls and queued calls: `false` matches unchanged engine input, while `true`
and omitted options match 0.4.1. It also checks nonboolean rejection and queued
input snapshots. CI runs this on Node 22, 24, and 26 across Windows, macOS, and
Linux. The real browser checks compare both choices with the independent
hashes in Chrome, Firefox, and WebKit.

Run `npm run build`, `npm test`, and `npm run verify:pack` for Node evidence in
`output/default-styles/`. Then run `npm run verify:browser:prepare` and
`python tools/check-browser.py` for browser evidence. CI retains the PDFs,
previews, and verification records with its artifacts.
