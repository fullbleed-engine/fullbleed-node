# Stylesheets, SVG and inset shadows

Fullbleed JavaScript 0.7.1 pins the unchanged published Fullbleed 2.5.29
Rust engine. Both `fullbleed` and `fullbleed/browser` use that engine.
The component, JSX and static HTML export APIs are unchanged.

This update brings the stable engine's SVG cascade and inset-shadow fixes
to JavaScript, together with the correction for isolated-group opacity in
saved-PDF previews. For example, an SVG shape selected by `.mark { fill: #d00000; }`
must use that color instead of the default black. An inset shadow translated
beyond the box must still shade the appropriate interior, and a negative-spread
shadow must leave its specified clear area untouched.

Pass document CSS through the `css` option, or attach a `StyleSheet` to a
component document. The upgraded engine also reads supported static HTML
`<style>` sheets: the seven installed component examples produce identical PDF
and preview bytes when rendered from their complete styled HTML export with an
empty CSS argument. Remote stylesheets are not fetched. Exported HTML
can include the document stylesheet with `toHtml({ includeStyles: true })` or
omit styles while preserving classes with `toHtml({ includeStyles: false })`.

## Verification inputs

[`engine-paint-2.5.28.json`](../test/fixtures/engine-paint-2.5.28.json) contains
141 fixtures derived from the 2.5.28 core SVG and shadow checks. Their source
cases, expected colors and tolerances are unchanged; the engine under test is
now 2.5.29:

- 106 SVG cases, including document selectors, inline SVG styles, inheritance,
  cascade priorities, custom properties, current color, opacity, gradients,
  masks, use references and external-image isolation. Inline SVG cases also
  exercise a zero-effect filter fallback.
- 27 inset-shadow cases covering signed spread, translation, blur, tables and
  page-edge clipping.
- Eight source/control documents for four complete clear-region comparisons
  at 300 DPI.

The paint checks compare explicit RGB expectations and Gaussian blur probes in
both the generated preview and an independent PDFium rendering. They also check
page counts, extracted text, physical page sizes and text bounds. The clear-region
checks compare every pixel in the specified region against a shadow-free control.

The release gate requires all fixtures from Node worker and process isolation
on Windows and Linux, plus actual Chrome, Firefox and WebKit downloads. Native
Rust and WASI output must match for these same fixtures. Repeated PDF and preview
bytes must match. The earlier component, HTML export, hidden-text, default-style
and font checks remain in the gate with their retained expectations.

The public 0.7.0 package is the negative control: it reproduces SVG and shadow
paint failures while passing explicit-color and empty-shadow controls. The held 2.5.28 candidate additionally reproduces four worker/process failures in saved-PDF previews for overlapping group members and reused symbols; its independently rendered PDFs pass. Both failing inputs and outputs are retained. This
distinguishes the regressions from an unreadable PDF or a broken test harness.

Release-specific PDF/PNG outputs, reports and the exact tested npm tarball are
retained with the [GitHub release](https://github.com/fullbleed-engine/fullbleed-node/releases/tag/v0.7.1).
These checks cover the specified inputs and supported rendering options; they
do not establish complete CSS/browser parity or PDF standards conformance.
