// SPDX-License-Identifier: MIT
import { Document, Heading, Paragraph, Stack, Row, LayoutGrid, Card } from 'fullbleed/ui';

/** Shared structured inputs; actual nodes are built independently in Node and browser. */
export function componentCases(data, Invoice) {
  const long = { ...data, items: Array.from({ length: 60 }, (_, index) => ({ ...data.items[index % data.items.length],
    name: `Work item ${String(index + 1).padStart(2, '0')}` })) };
  const records = {
    invoice: data,
    paid: { ...data, paid: true },
    empty: { ...data, items: [] },
    escaped: { ...data, customer: '<script> & "Partners"' },
    credit: { ...data, items: [{ ...data.items[0], name: 'Credit adjustment', quantity: 1, rate_cents: -150 }] },
    long,
  };
  const cases = Object.entries(records).map(([name, data]) => ({ name: 'component-' + name, node: Invoice({ data }),
    pages: name === 'long' ? 7 : 1, text: [data.customer, name === 'long' ? 'Work item 60' : name === 'credit' ? '-$1.50' :
      name === 'empty' ? '$0.00' : name === 'paid' ? 'This invoice has been settled.' : '$8,100.00'] }));
  cases.push({ name: 'component-layouts', pages: 1, text: ['Stack one', 'Stack two', 'Row left', 'Row right', 'Grid alpha', 'Grid beta'],
    node: Document({ styles: { '@page': { size: 'A4', margin: '20mm' }, body: { fontFamily: 'Inter', fontSize: '11pt' },
      'h1, p': { margin: 0 } } },
    Stack({ gap: '20pt' }, Heading({ level: 1 }, 'Reusable layouts'),
      Card(Stack({ gap: '6pt' }, Paragraph('Stack one'), Paragraph('Stack two'))),
      Row({ justify: 'space-between', gap: '12pt' }, Paragraph('Row left'), Paragraph('Row right')),
      LayoutGrid({ columns: 2, gap: '18pt' }, Card(Paragraph('Grid alpha')), Card(Paragraph('Grid beta'))))) });
  return cases;
}
