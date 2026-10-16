// SPDX-License-Identifier: MIT
// Runs in both the isolated tarball consumer and browser; no PDF runtime import.
import { Document, Heading, Paragraph, Row, el, toHtml } from 'fullbleed/ui';
import { jsx } from 'fullbleed/ui/jsx-runtime';

export function htmlExportCases() {
  const text = 'A < B & C';
  const css = {
    body: { color: '#102030', fontFamily: 'serif' },
    '.title': { color: '#175c52' },
    '.amount': { color: '#c2410c', fontWeight: 700 },
    '.literal::before': { content: '"</StYle><script>bad()</script>"' },
    '.literal::after': { content: String.raw`"\</style>"` },
  };
  const styles = [css, '@media (width < 10000px) { .customer { color: #204060; } }'];
  const props = { title: 'HTML export & reuse', styles };
  const heading = { className: 'title', level: 1 };
  const row = { className: 'totals', gap: '18px', style: { padding: '12px' } };
  const amount = { className: 'amount', style: { fontSize: '19px' } };
  const content = Row(row, Paragraph({ className: 'customer' }, text), Paragraph(amount, 'USD 120.00'));
  const doc = Document(props, Heading(heading, 'Quarterly report'), content, Paragraph({ className: 'literal' }, 'Literal CSS text'));
  const jsxDoc = jsx(Document, { ...props, children: [
    jsx(Heading, { ...heading, children: 'Quarterly report' }),
    jsx(Row, { ...row, children: [jsx(Paragraph, { className: 'customer', children: text }), jsx(Paragraph, { ...amount, children: 'USD 120.00' })] }),
    jsx(Paragraph, { className: 'literal', children: 'Literal CSS text' }),
  ] });
  const removable = el('section', { className: 'sources', STYLE: 'color:red' },
    el('STYLE', null, '.sources { color:red }'),
    el('link', { REL: 'alternate\tStyleSheet', href: 'https://invalid.example/theme.css' }),
    Paragraph({ className: 'customer', style: 'color:red' }, text));
  return {
    styled: doc.toHtml({ includeStyles: true }),
    unstyled: doc.toHtml({ includeStyles: false }),
    override: doc.toHtml({ includeStyles: true, styles: { '.amount': { color: '#123456' } } }),
    jsx: toHtml(jsxDoc, { includeStyles: true }),
    fragment: toHtml([Heading(heading, 'Fragment'), content], { includeStyles: true, styles }),
    fragmentUnstyled: toHtml([Heading(heading, 'Fragment'), content], { includeStyles: false }),
    sourcesRemoved: removable.toHtml({ includeStyles: false }),
    legacy: doc.toHtml(),
  };
}
