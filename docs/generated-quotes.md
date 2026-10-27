# CSS-generated quotation marks

Fullbleed 0.8.3 uses the published 2.5.38 engine. Nested quotations retain their
closing marks when a quoted element uses `display: block`, `inline-block` or
`contents`. Layout measurement no longer consumes quotation depth, and silent
`no-open-quote` and `no-close-quote` tokens take effect in document order.
These depth rules are described in the [CSS quotation specification](https://www.w3.org/TR/CSS2/generate.html#quotes).

For example, this document produces `[outer{inner}end]`:

```html
<div class="quote">outer<span class="quote">inner</span>end</div>
```

```css
body { quotes: "[" "]" "{" "}"; }
.quote::before { content: open-quote; }
.quote::after { content: close-quote; }
```

Pass the HTML and CSS to `renderPdf()`. The same static styles work with generated
HTML from components. The fix changes generated punctuation; literal quotation
marks in text do not require this feature.

## Reproduce the checks

The [41 fixtures](../test/fixtures/generated-quotes-2.5.38.json) retain the core
engine's independently specified expected text. They cover the four display
modes, silent tokens, depth limits, hidden content, replaced elements and a
literal-text control.

```sh
npm run build
npm run verify:pack
npm run render:quotes
npm run verify:quotes
```

The renderer runs each fixture twice in both Node worker and process isolation.
The verifier reads the saved PDFs with pypdf and PDFium, checks exact text and
page geometry, and retains both engine previews and independent raster images.
CI also exercises downloaded PDFs in Chrome, Firefox and Playwright WebKit.
The public 0.8.2 package is the failure control: 25 of the 41 fixtures fail in
each Node isolation mode. The remaining 16 fixtures must preserve PDF and preview
bytes after the upgrade.

These checks cover the named quotation cases. They do not establish complete CSS
compatibility, performance or PDF conformance.
