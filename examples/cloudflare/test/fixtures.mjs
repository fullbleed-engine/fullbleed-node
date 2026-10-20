// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
const sample = JSON.parse(await readFile(new URL('../sample.json', import.meta.url), 'utf8'));
export const cases = [
  { name: 'sample', data: sample, minPages: 1, maxPages: 1,
    text: ['Maple & Finch', '$8,100.00', '01 October 2026'] },
  { name: 'minimum', data: { ...sample, number: 'NS-1043', paid: true,
    items: [{ ...sample.items[0], quantity: 1, rate_cents: 0, progress: 0 }] },
    minPages: 1, maxPages: 1, text: ['$0.00', 'This invoice has been settled.'] },
  { name: 'maximum-total', data: { ...sample, number: 'NS-1044',
    items: [{ ...sample.items[0], quantity: 1, rate_cents: 99999999 }] },
    minPages: 1, maxPages: 1, text: ['$999,999.99'] },
  { name: 'long', data: { ...sample, number: 'NS-1045',
    customer: 'Maple & Finch International Design and Community Research Partnership',
    items: Array.from({ length: 30 }, (_, i) => ({ name: `Work package ${i + 1}: design, research and delivery`,
      detail: 'A considered set of activities, documented decisions and practical resources for the next phase of the project.',
      quantity: 2, rate_cents: 15000, progress: 75 })) },
    minPages: 3, maxPages: 10, text: ['Work package 30:', '$9,000.00'] },
  { name: 'escaped', data: { ...sample, number: 'NS-1046', customer: '<script>alert(1)</script> & Partners' },
    minPages: 1, maxPages: 2, text: ['<script>alert(1)</script> & Partners', '$8,100.00'] },
];
export const invalidCases = [
  { name: 'json', body: '{', status: 400, code: 'INVALID_JSON' },
  { name: 'content-type', body: JSON.stringify(sample), contentType: 'text/plain', status: 415, code: 'JSON_REQUIRED' },
  { name: 'body-limit', body: JSON.stringify({ padding: 'x'.repeat(32769) }), status: 413, code: 'BODY_TOO_LARGE' },
  { name: 'number', data: { ...sample, number: '../private' }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'date', data: { ...sample, due: '2026-02-30' }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'money', data: { ...sample, items: [{ ...sample.items[0], rate_cents: 1.5 }] }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'total', data: { ...sample, items: [{ ...sample.items[0], rate_cents: 99999999 }] }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'row-limit', data: { ...sample, items: Array(31).fill(sample.items[0]) }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'unknown', data: { ...sample, html: '<h1>Arbitrary template</h1>' }, status: 400, code: 'INVALID_INVOICE' },
  { name: 'glyph', data: { ...sample, customer: 'Customer \u{10ffff}' }, status: 422, code: 'MISSING_GLYPHS' },
];
