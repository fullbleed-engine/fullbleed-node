// SPDX-License-Identifier: MIT
import { component, Document, Box, Text, Paragraph, Strong, Header, Footer, Heading,
  LineBreak, Section, LayoutGrid, Table, TableCaption, THead, TBody, Tr, Th, Td } from 'fullbleed/ui';
import { invoiceStyles } from './styles.mjs';

export function money(cents) {
  if (!Number.isSafeInteger(cents)) throw new TypeError('Amounts must be safe integer cents');
  const value = Math.abs(cents);
  return (cents < 0 ? '-' : '') + '$' + Math.floor(value / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    '.' + String(value % 100).padStart(2, '0');
}
export const Field = component(({ label, value }) =>
  Box(Text({ className: 'label' }, label), Paragraph({ className: 'value' }, value)));
export const WorkRow = component(({ item }) => Tr(
  Td({ className: 'work' }, Paragraph({ className: 'item-name' }, item.name),
    Paragraph({ className: 'detail' }, item.detail),
    Box({ className: 'progress-track', 'aria-hidden': true },
      Box({ className: 'progress-fill', style: { width: `${item.progress}%` } }))),
  Td({ className: 'number hours' }, item.quantity),
  Td({ className: 'number rate' }, money(item.rate_cents)),
  Td({ className: 'number amount' }, money(item.quantity * item.rate_cents))));
export const WorkTable = component(({ items }) => Table(
  TableCaption('The work, in detail'),
  THead(Tr(
    Th({ className: 'work', scope: 'col' }, 'Project'),
    Th({ className: 'number hours', scope: 'col' }, 'Hours'),
    Th({ className: 'number rate', scope: 'col' }, 'Rate'),
    Th({ className: 'number amount', scope: 'col' }, 'Amount'))),
  TBody(items.map(item => WorkRow({ item })))));
export const Total = component(({ items, due, paid }) => Section({ className: 'total', 'aria-label': 'Invoice total' },
  Text({ className: 'label' }, paid ? 'Paid in full' : 'Amount due · USD'),
  Paragraph({ className: 'total-amount' }, money(items.reduce((sum, item) => sum + item.quantity * item.rate_cents, 0))),
  Paragraph({ className: 'total-note' }, paid ? 'Thank you.' : `Due ${due}`)));
export const PaymentNote = component(({ paid }) => Box(
  Paragraph({ className: 'note' }, Strong('Onward, together.'),
    'Please include the invoice number with your payment. We’re grateful to be part of what comes next.'),
  paid && Paragraph({ style: { fontSize: '8pt', marginTop: '6pt' } }, 'This invoice has been settled.')));
export const Invoice = component(({ data }) => Document({ title: 'Northstar Studio / Invoice', lang: 'en', styles: invoiceStyles },
  Header({ className: 'brand' }, Paragraph({ className: 'wordmark' }, 'NORTHSTAR / STUDIO'),
    Paragraph({ className: 'brand-note' }, 'Independent design.\nThoughtful by nature.')),
  Section({ className: 'intro' }, Paragraph({ className: 'eyebrow' }, `Invoice ${data.number} · ${data.period}`),
    Heading({ level: 1 }, 'Good work.', LineBreak(), 'Clear numbers.'),
    Paragraph({ className: 'lede' }, 'A shared vision, made tangible. Here’s the work we brought to life together.')),
  LayoutGrid({ className: 'meta', 'aria-label': 'Invoice details' }, Field({ label: 'Prepared for', value: data.customer }),
    Field({ label: 'Issued', value: data.issued }), Field({ label: 'Payment due', value: data.due })),
  WorkTable({ items: data.items }),
  LayoutGrid({ className: 'summary', 'aria-label': 'Payment summary' }, PaymentNote({ paid: data.paid }), Total(data)),
  Footer({ className: 'footer' }, 'NORTHSTAR STUDIO  /  FICTIONAL DEMONSTRATION  /  GENERATED WITH FULLBLEED')));
