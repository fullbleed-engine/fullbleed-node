import { component, document, el, style, toHtml, type Child, type Element } from 'fullbleed/ui';

const Line = component((props: { label: string; amount: number }): Element =>
  el('p', { className: 'line', style: style({ fontWeight: 600 }) }, props.label, props.amount));
const rows: Child[] = [Line({ label: 'Research', amount: 12 }), false, [el('hr', null)]];
const html: string = toHtml(document({ title: 'Report' }, rows));
void html;
// @ts-expect-error The component retains its argument types.
Line({ label: 'Research', amount: 'twelve' });
// @ts-expect-error Object representations cannot be document children.
el('p', null, { customer: 'Alice' });
