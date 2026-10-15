// SPDX-License-Identifier: MIT
export interface Item { name: string; detail: string; quantity: number; rate_cents: number; progress: number }
export interface InvoiceData {
  number: string; customer: string; period: string; issued: string; due: string; paid: boolean; items: Item[];
}
export interface ItemDraft { id: number; name: string; detail: string; quantity: string; rate: string; progress: number }

export function money(cents: number) {
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(absolute % 100).padStart(2, '0')}`;
}

export const sample: InvoiceData = {
  "number": "NS-1042",
  "customer": "Maple & Finch",
  "period": "September 2026",
  "issued": "01 October 2026",
  "due": "15 October 2026",
  "paid": false,
  "items": [
    {
      "name": "Discovery & direction",
      "detail": "Stakeholder workshops and a clear creative brief.",
      "quantity": 12,
      "rate_cents": 15000,
      "progress": 100
    },
    {
      "name": "Identity system",
      "detail": "Typography, color, and the pieces that bring it together.",
      "quantity": 24,
      "rate_cents": 15000,
      "progress": 100
    },
    {
      "name": "Digital experience",
      "detail": "A considered home for a growing brand.",
      "quantity": 18,
      "rate_cents": 15000,
      "progress": 75
    }
  ]
};

export const initialItems = (): ItemDraft[] => sample.items.map((item, index) => ({
  id: index + 1, name: item.name, detail: item.detail, quantity: String(item.quantity),
  rate: (item.rate_cents / 100).toFixed(2), progress: item.progress,
}));

/** Parse decimal inputs into integer cents before composing the document. */
export function parseItems(drafts: ItemDraft[]): { items: Item[]; error: string } {
  const items: Item[] = [];
  for (const [index, draft] of drafts.entries()) {
    if (!draft.name.trim()) return { items: [], error: `Enter a name for item ${index + 1}.` };
    if (!/^\d{1,4}$/.test(draft.quantity)) return { items: [], error: `Item ${index + 1}: enter whole hours from 0 to 9999.` };
    if (!/^-?\d{1,6}(?:\.\d{1,2})?$/.test(draft.rate)) return { items: [], error: `Item ${index + 1}: enter a USD rate with at most two decimal places.` };
    const [whole, fraction = ''] = draft.rate.replace('-', '').split('.');
    const rate_cents = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (draft.rate.startsWith('-') ? -1 : 1);
    items.push({ name: draft.name.trim(), detail: draft.detail.trim(), quantity: Number(draft.quantity), rate_cents, progress: draft.progress });
  }
  return { items, error: '' };
}
