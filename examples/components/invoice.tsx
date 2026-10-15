/** @jsxImportSource fullbleed/ui */
// SPDX-License-Identifier: MIT
import { Document, Box, Text, Paragraph, Strong, Header, Footer, Heading, LineBreak,
  Section, LayoutGrid, Table, TableCaption, THead, TBody, Tr, Th, Td } from 'fullbleed/ui';
import { invoiceStyles } from './styles.mjs';
import { money } from './document.mjs';

export interface Item { name: string; detail: string; quantity: number; rate_cents: number; progress: number }
export interface InvoiceData {
  number: string; customer: string; period: string; issued: string; due: string; paid: boolean; items: Item[];
}
function Field({ label, value }: { label: string; value: string }) {
  return <Box><Text className="label">{label}</Text><Paragraph className="value">{value}</Paragraph></Box>;
}
function WorkRow({ item }: { item: Item }) {
  return <Tr>
    <Td className="work"><Paragraph className="item-name">{item.name}</Paragraph>
      <Paragraph className="detail">{item.detail}</Paragraph>
      <Box className="progress-track" aria-hidden={true}><Box className="progress-fill" style={{ width: `${item.progress}%` }} /></Box></Td>
    <Td className="number hours">{item.quantity}</Td>
    <Td className="number rate">{money(item.rate_cents)}</Td>
    <Td className="number amount">{money(item.quantity * item.rate_cents)}</Td>
  </Tr>;
}
function WorkTable({ items }: { items: Item[] }) {
  return <Table><TableCaption>The work, in detail</TableCaption>
    <THead><Tr><Th className="work" scope="col">Project</Th><Th className="number hours" scope="col">Hours</Th>
      <Th className="number rate" scope="col">Rate</Th><Th className="number amount" scope="col">Amount</Th></Tr></THead>
    <TBody>{items.map((item, index) => <WorkRow key={index} item={item} />)}</TBody>
  </Table>;
}
function Total({ items, due, paid }: Pick<InvoiceData, 'items' | 'due' | 'paid'>) {
  return <Section className="total" aria-label="Invoice total">
    <Text className="label">{paid ? 'Paid in full' : 'Amount due · USD'}</Text>
    <Paragraph className="total-amount">{money(items.reduce((sum, item) => sum + item.quantity * item.rate_cents, 0))}</Paragraph>
    <Paragraph className="total-note">{paid ? 'Thank you.' : `Due ${due}`}</Paragraph>
  </Section>;
}
function PaymentNote({ paid }: { paid: boolean }) {
  return <Box>
    <Paragraph className="note"><Strong>Onward, together.</Strong>Please include the invoice number with your payment. We’re grateful to be part of what comes next.</Paragraph>
    {paid && <Paragraph style={{ fontSize: '8pt', marginTop: '6pt' }}>This invoice has been settled.</Paragraph>}
  </Box>;
}
export function Invoice({ data }: { data: InvoiceData }) {
  return <Document title="Northstar Studio / Invoice" lang="en" styles={invoiceStyles}>
    <Header className="brand"><Paragraph className="wordmark">NORTHSTAR / STUDIO</Paragraph>
      <Paragraph className="brand-note">{'Independent design.\nThoughtful by nature.'}</Paragraph></Header>
    <Section className="intro"><Paragraph className="eyebrow">{`Invoice ${data.number} · ${data.period}`}</Paragraph>
      <Heading level={1}>Good work.<LineBreak />Clear numbers.</Heading>
      <Paragraph className="lede">A shared vision, made tangible. Here’s the work we brought to life together.</Paragraph></Section>
    <LayoutGrid className="meta" aria-label="Invoice details"><Field label="Prepared for" value={data.customer} />
      <Field label="Issued" value={data.issued} /><Field label="Payment due" value={data.due} /></LayoutGrid>
    <WorkTable items={data.items} />
    <LayoutGrid className="summary" aria-label="Payment summary"><PaymentNote paid={data.paid} /><Total {...data} /></LayoutGrid>
    <Footer className="footer">NORTHSTAR STUDIO  /  FICTIONAL DEMONSTRATION  /  GENERATED WITH FULLBLEED</Footer>
  </Document>;
}
