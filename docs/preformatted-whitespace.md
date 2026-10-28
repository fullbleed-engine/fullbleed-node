# Whitespace and wrapping in code blocks

Fullbleed 0.8.6 uses the published 2.5.41 engine. Preformatted blocks now use
authored CSS for both whitespace normalization and line wrapping.

```css
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

`pre-wrap` preserves indentation and newlines. `overflow-wrap: anywhere` also
allows a long token to break within the printable width. Use `pre-line` to
preserve newlines while collapsing indentation, or `normal` to collapse both.
Default `pre`, `white-space: nowrap` and explicit no-wrap policies retain their
behavior. Documents requesting wrapping may gain pages; review saved output
when upgrading.

The installed-package checks use seventeen inputs through worker and process
isolation. Independent readers check complete single-copy text, embedded fonts,
glyph bounds, pagination, indentation and line breaks. Public 0.8.5 reproduces
twenty failures and fourteen passing controls; the candidate must pass all
thirty-four cases and preserve those controls. CI retains PDFs and both native
and independently rasterized previews. These fixtures do not establish complete
CSS support or general browser parity.
