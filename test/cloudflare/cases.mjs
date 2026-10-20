import { Document, Heading, Paragraph, Box, Table, THead, TBody, Tr, Th, Td } from 'fullbleed/ui';
import raw from './raw.json' with { type: 'json' };

export const caseNames = ['invoice', 'report', 'custom-assets', 'components', 'components-inline'];
export const expected = {
  invoice: { pages: 1, text: ['Northstar', 'NS-1042', 'Cedar & Co.', '$1,870.00'] },
  report: { pages: 3, text: ['COMMON', 'GROUND', '1,240', '4,860', '$420,000.00'] },
  'custom-assets': { pages: 1, text: ['Custom font and image', 'Type Alpha with care.'], face: 'LibreCaslonText-Regular' },
  components: { pages: 1, text: ['Worker statement', 'Cedar & Co. <em>safe</em>', '$1,870.00'] },
  'components-inline': { pages: 1, text: ['Worker statement', 'Cedar & Co. <em>safe</em>', '$1,870.00'] },
};

export function optionsFor(name, customFont) {
  const common = { defaultStyles: false, maxPages: 20, previewDpi: 96 };
  if (name === 'invoice' || name === 'report') return { ...common, ...raw[name] };
  if (name === 'custom-assets') return { ...common, fonts: [customFont],
    html: '<h1>Custom font and image</h1><p>Type Alpha with care.</p><img src="assets/charts/marker.svg" width="180" height="90" alt="Green panel with an orange circle">',
    css: '@page{size:A4;margin:20mm} body{font-family:"Libre Caslon Text";font-size:18pt;color:#173b35} h1{font-size:24pt}',
    assets: { 'charts/marker.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="#173b35"/><circle cx="90" cy="45" r="30" fill="#d85330"/></svg>') } };
  if (name === 'components' || name === 'components-inline') {
    const doc = Document({ title: 'Worker statement', styles: [
      '@page { size:A4; margin:20mm }',
      { body: { fontFamily: 'Inter', color: '#173b35' }, '.amount': { color: '#d85330', fontSize: '28pt' },
        table: { width: '100%', borderCollapse: 'collapse' }, 'th, td': { padding: '8pt', borderBottom: '1pt solid #a4ae78' } },
    ] }, Heading({ level: 1 }, 'Worker statement'), Paragraph('Cedar & Co. <em>safe</em>'),
    Table(THead(Tr(Th('Work'), Th('Amount'))), TBody(Tr(Td('Design and delivery'), Td('$1,870.00')))),
    Box({ className: 'amount' }, '$1,870.00'));
    return name === 'components-inline'
      // The engine takes CSS explicitly; embedded styles are for browser HTML export.
      ? { ...common, html: doc.toHtml({ includeStyles: true }), css: doc.toCss() }
      : { ...common, html: doc.toHtml(), css: doc.toCss() };
  }
  throw new Error('Unknown fixture: ' + name);
}

export function errorOptions(name, customFont) {
  const basic = { html: '<p>Valid recovery document</p>' };
  switch (name) {
    case 'timeout': return { ...basic, timeoutMs: 10 };
    case 'signal': return { ...basic, signal: new AbortController().signal };
    case 'isolation': return { ...basic, isolation: 'worker' };
    case 'source-limit': return { html: 'é'.repeat(500_001) };
    case 'asset-limit': return { ...basic, assets: { 'large.bin': new Uint8Array(8 * 1024 * 1024 + 1) } };
    case 'asset-path': return { ...basic, assets: { '../outside': new Uint8Array([1]) } };
    case 'asset-collision': return { ...basic, assets: { a: new Uint8Array([1]), 'a/b': new Uint8Array([2]) } };
    case 'pages': return { ...optionsFor('report', customFont), maxPages: 1, previewDpi: 0 };
    case 'default-pages': return { html: '<section>Page</section>'.repeat(21), css: 'section{break-after:page}' };
    case 'glyph': return { html: '<p>漢字</p>', css: 'body{font-family:Inter}' };
    default: throw new Error('Unknown error fixture');
  }
}
