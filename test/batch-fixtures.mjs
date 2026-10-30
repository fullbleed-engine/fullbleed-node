// SPDX-License-Identifier: MIT
import { document, Heading, Paragraph } from 'fullbleed/ui';

export const batchShort = {
  html: '<h1>Account {{account}}</h1><p>{{message}}</p><p>END {{account}}</p>',
  css: '@page {size:220pt 160pt; margin:16pt} body {font:10pt Inter;line-height:12pt} h1 {font-size:14pt;margin:0 0 6pt} p {margin:6pt 0}',
  records: [{ account: '1042', message: 'Active.' }, { account: '1043', message: 'Review scheduled.' }],
};
export const batchLong = { ...batchShort, records: [batchShort.records[0],
  { account: '1043', message: 'This longer notice continues onto another page. '.repeat(20) }] };
export const batchComponentTemplate = document({ title: 'Batch notices', styles: '@page {size:A5;margin:18mm} body{font-family:Inter}' },
  Heading('Account {{account}}'), Paragraph('{{message}}'));
const missing = String.fromCodePoint(0x10ffff);
const literal = Object.fromEntries([['__proto__', 'Café & <b>literal</b> "quoted" \\ path']]);
const fallback = { ...batchShort,
  css: batchShort.css + ' body {font-family:Inter,"Noto Sans Math"}',
  records: [{ account: '1042', message: 'ASCII math' }, { account: '1043', message: 'Integral: ⨌' }],
};

// Pure fixture data can be copied into an installed consumer or browser harness.
// Each runtime loads fontFiles explicitly; no fixture fetches its own assets.
export const batchFixtures = [
  { name: 'batch-fixed', pages: 2, recordPages: [1, 1], missingGlyphs: 0, missingRows: [[], []],
    options: { ...batchShort, layout: 'fixed', previewDpi: 72 } },
  { name: 'batch-reflow', pages: 5, recordPages: [1, 4], missingGlyphs: 0, missingRows: [[], []],
    options: { ...batchLong, previewDpi: 72 } },
  { name: 'batch-missing', pages: 2, recordPages: [1, 1], missingGlyphs: 1,
    missingRows: [[{ codepoint: 0x10ffff, count: 1 }], [{ codepoint: 0x10ffff, count: 3 }]],
    options: { ...batchShort, records: [{ account: '1042', message: missing }, { account: '1043', message: missing.repeat(3) }],
      allowMissingGlyphs: true, previewDpi: 0 } },
  { name: 'batch-components', pages: 2, recordPages: [1, 1], missingGlyphs: 0, missingRows: [[], []],
    options: { html: batchComponentTemplate.toHtml(), css: batchComponentTemplate.toCss(), records: batchShort.records,
      defaultStyles: false, previewDpi: 72 } },
  { name: 'batch-literal', pages: 1, recordPages: [1], missingGlyphs: 0, missingRows: [[]],
    options: { html: '<p>{{__proto__}}</p>', css: '@page {size:A5;margin:18mm}', records: [literal], previewDpi: 72 } },
  { name: 'batch-fallback-fixed', pages: 2, recordPages: [1, 1], missingGlyphs: 1,
    missingRows: [[], [{ codepoint: 0x2a0c, count: 1 }]], fontFiles: ['NotoSansMath-Regular.ttf'],
    options: { ...fallback, layout: 'fixed', allowMissingGlyphs: true, previewDpi: 72 } },
  { name: 'batch-fallback-reflow', pages: 2, recordPages: [1, 1], missingGlyphs: 0, missingRows: [[], []],
    fontFiles: ['NotoSansMath-Regular.ttf'], options: { ...fallback, layout: 'reflow', previewDpi: 72 } },
];
