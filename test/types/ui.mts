import { component, document, el, style, toHtml, type Child, type Element } from 'fullbleed/ui';

const Line = component((props: { label: string; amount: number }): Element =>
  el('p', { className: 'line', style: style({ fontWeight: 600 }) }, props.label, props.amount));
const rows: Child[] = [Line({ label: 'Research', amount: 12 }), false, [el('hr', null)]];
const html: string = toHtml(document({ title: 'Report' }, rows));
const styled: string = document(rows).toHtml({ includeStyles: true, styles: { '.line': { color: 'navy' } } });
const plain: string = Line({ label: 'Total', amount: 12 }).toHtml({ includeStyles: false });
const fragment: string = toHtml(rows, { includeStyles: true });
const includeStyles: boolean = Math.random() > 0.5;
toHtml(rows, { includeStyles });
void [styled, plain, fragment];
// @ts-expect-error Styles must explicitly be included when supplying export CSS.
toHtml(rows, { styles: 'p { color:red }' });
// @ts-expect-error Unstyled HTML cannot also request CSS overrides.
document(rows).toHtml({ includeStyles: false, styles: 'p { color:red }' });
// @ts-expect-error Export flags are booleans.
toHtml(rows, { includeStyles: 'yes' });
void html;
// @ts-expect-error The component retains its argument types.
Line({ label: 'Research', amount: 'twelve' });
// @ts-expect-error Object representations cannot be document children.
el('p', null, { customer: 'Alice' });
