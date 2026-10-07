// SPDX-License-Identifier: MIT
// These names select unembedded Standard 14 faces, whose previews were blank
// in the 0.3.1 WebAssembly package. The Inter control uses an embedded font.
export const standardFontText = 'Invoice AV 105 & caf\u00e9';
export const standardFontFixtures = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Inter',
].map(font => ({
  name: 'standard-' + font, font, pages: 1,
  html: '<p>Invoice AV 105 &amp; caf&#233;</p>',
  css: `@page {size:300pt 100pt;margin:12pt} p {margin:0;font-family:"${font}";font-size:20pt}`,
}));
