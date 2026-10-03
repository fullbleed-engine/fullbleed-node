// SPDX-License-Identifier: MIT
import { renderPdf, FullbleedError } from 'fullbleed';
import { getDemoInvoice, invoiceTemplate } from '../../../../lib/invoice.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One active render per process; there is no unbounded waiting queue.
// Add authentication and a shared rate/usage limit for a deployed application.
let active = 0;
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const errorResponse = (status, code, message, extra = {}) => Response.json(
  { error: { code, message } }, { status, headers: { ...privateHeaders, ...extra } },
);

export async function GET(request, { params }) {
  const { id } = await params;
  const invoice = getDemoInvoice(id);
  if (!invoice) return errorResponse(404, 'NOT_FOUND', 'Sample invoice not found.');
  if (active >= 1) return errorResponse(503, 'BUSY', 'A document is being prepared. Try again shortly.', { 'Retry-After': '2' });
  active++;
  try {
    const template = await invoiceTemplate(invoice);
    const { pdf } = await renderPdf({ ...template, maxPages: 5, timeoutMs: 15_000, signal: request.signal });
    return new Response(pdf, {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${invoice.id}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (error) {
    const code = error instanceof FullbleedError ? error.code : 'UNEXPECTED';
    // Log an operational code only; never log customer data or document input.
    console.error('Fullbleed invoice render failed:', code);
    if (code === 'TIMEOUT') return errorResponse(504, code, 'Document preparation timed out.');
    if (code === 'ABORTED') return errorResponse(408, code, 'Document preparation was cancelled.');
    return errorResponse(500, 'RENDER_FAILED', 'The document could not be prepared.');
  } finally {
    active--;
  }
}
