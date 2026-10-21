// SPDX-License-Identifier: MIT
import { Invoice } from './document.mjs';

const BODY_LIMIT = 32 * 1024;
const MAX_CENTS = 99_999_999;
class RequestError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const invalid = message => { throw new RequestError(400, 'INVALID_INVOICE', message); };
const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
function fields(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`${label} has an unknown field.`);
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${label} must contain 1 to ${max} characters without control characters.`);
  }
  return value.trim();
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) invalid(`${label} must be a date in YYYY-MM-DD format (2000–2099).`);
  const stamp = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== value) invalid(`${label} is not a calendar date.`);
  return stamp.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function validateInvoice(data) {
  fields(data, ['number', 'customer', 'period', 'issued', 'due', 'paid', 'items'], 'Invoice');
  const number = text(data.number, 32, 'number');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(number)) invalid('number must use letters, digits, underscores or hyphens.');
  const customer = text(data.customer, 80, 'customer');
  const period = text(data.period, 32, 'period');
  const issued = date(data.issued, 'issued');
  const due = date(data.due, 'due');
  if (data.due < data.issued) invalid('due must be on or after issued.');
  if (typeof data.paid !== 'boolean') invalid('paid must be a boolean.');
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 30) invalid('items must contain 1 to 30 rows.');
  let total = 0;
  const items = data.items.map((item, i) => {
    const label = `items[${i}]`;
    fields(item, ['name', 'detail', 'quantity', 'rate_cents', 'progress'], label);
    const name = text(item.name, 60, `${label}.name`);
    const detail = text(item.detail, 160, `${label}.detail`);
    const quantity = integer(item.quantity, 1, 999, `${label}.quantity`);
    const rate_cents = integer(item.rate_cents, 0, MAX_CENTS, `${label}.rate_cents`);
    const progress = integer(item.progress, 0, 100, `${label}.progress`);
    total += quantity * rate_cents;
    if (total > MAX_CENTS) invalid('The invoice total must not exceed $999,999.99.');
    return { name, detail, quantity, rate_cents, progress };
  });
  return { number, customer, period, issued, due, paid: data.paid, items };
}
async function readJson(request) {
  if ((request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'JSON_REQUIRED', 'Send application/json.');
  }
  // Enforce the limit on actual streamed bytes, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'INVALID_JSON', 'Send a JSON invoice.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new RequestError(413, 'BODY_TOO_LARGE', 'JSON must not exceed 32 KiB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, 'INVALID_JSON', 'Send valid UTF-8 JSON.'); }
}
export function invoiceHandler(renderPdf) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return json({ ok: true });
      if (path !== '/invoice') return json({ error: 'NOT_FOUND', message: 'POST JSON to /invoice.' }, 404);
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }, 405, { Allow: 'POST' });
      try {
        const data = validateInvoice(await readJson(request));
        const result = await Invoice({ data }).renderPdf(renderPdf, { maxPages: 10, defaultStyles: false });
        return new Response(result.pdf, { headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="invoice-${data.number}.pdf"`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        } });
      } catch (error) {
        if (error instanceof RequestError) return json({ error: error.code, message: error.message }, error.status);
        if (error?.code === 'MISSING_GLYPHS') return json({ error: 'MISSING_GLYPHS', message: 'This invoice needs an additional font. Register suitable font bytes in the Worker.' }, 422);
        if (error?.code === 'PAGE_LIMIT') return json({ error: 'PAGE_LIMIT', message: 'This invoice exceeds the 10-page limit.' }, 422);
        // Do not echo renderer errors or log invoice/customer data.
        return json({ error: 'RENDER_FAILED', message: 'The invoice could not be rendered.' }, 500);
      }
    },
  };
}
