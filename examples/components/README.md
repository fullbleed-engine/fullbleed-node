# A component-authored invoice

Compose the same designed invoice using either ordinary JavaScript functions
(`document.mjs`) or TSX (`invoice.tsx`). Both use `styles.mjs`, a `StyleSheet`
written as JavaScript rule maps, and the structured records in `data.json`.

From the repository root after `npm ci` and `npm run build`:

```sh
node examples/components/invoice.mjs
node examples/components/render-tsx.mjs
```

The first command requires no compiler. The optional TSX command uses the
development dependency esbuild to compile the dedicated document file. Both
write an invoice PDF, native PNG previews, HTML/CSS exports and a verification
receipt, and check that repeated rendering produces identical PDF bytes.

Fields, work rows, payment notes and totals are reusable components. Change the
data or stylesheet without constructing HTML strings. Amounts use integer cents;
credit amounts retain their sign. The document is a fictional demonstration.

See [the component guide](../../docs/components.md) for props, children, styles,
JSX configuration, explicit render queues and browser use.
