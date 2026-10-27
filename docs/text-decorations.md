# Underlines and other text decorations

Fullbleed 0.8.4 uses the published 2.5.40 engine. Underlines, overlines and
strikethroughs continue across spaces inside decorated text. For example:

```javascript
import { renderPdf } from 'fullbleed';

const { pdf } = await renderPdf({
  html: '<p>Offer: <span class="previous-price">USD 120 per month</span> USD 95</p>',
  css: `
    .previous-price {
      text-decoration-line: line-through;
      text-decoration-color: #9a4038;
      text-decoration-thickness: 1px;
    }
  `,
});
```

The strike continues across the words and their spaces. The same rule applies
to `underline` and `overline`. Collapsed spaces at a line's beginning or end do
not extend the decoration beyond the text.

Nested inline elements preserve the ancestor's decoration color, thickness and
baseline. A child's `text-decoration: none` removes its own decoration; it does
not erase a line established by an ancestor. Atomic inline boxes such as
`inline-block` keep a separate decoration boundary.

The retained checks cover sixteen direct-render cases, both Node execution modes
and browser PDF/PNG downloads. They include wrapping, word and letter spacing,
raised spans, explicit decoration boundaries, collapsed whitespace and shadows.
The public 0.8.3 package reproduces thirteen failing cases in each Node mode.
Existing healthy controls keep their PDF and preview bytes. See the
[release evidence](https://github.com/fullbleed-engine/fullbleed-node/releases/tag/v0.8.4)
for the package and platforms that were verified. These fixtures are a scoped
regression check, not a claim of complete CSS support.
