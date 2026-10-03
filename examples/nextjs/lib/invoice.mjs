// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Fictional public fixture, not an authorization implementation. In your app,
// replace this with an authenticated lookup scoped to the requesting account.
const invoices = new Map([
  ['NS-1042', { id: 'NS-1042', customer: 'Maple & Finch' }],
]);

export function getDemoInvoice(id) {
  return invoices.get(id);
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export async function invoiceTemplate(invoice) {
  const [html, css] = await Promise.all([
    readFile(join(process.cwd(), 'templates/invoice.html'), 'utf8'),
    readFile(join(process.cwd(), 'templates/invoice.css'), 'utf8'),
  ]);
  return { html: html.replace('{{customer}}', () => escapeHtml(invoice.customer)), css };
}
