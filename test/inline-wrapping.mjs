// SPDX-License-Identifier: MIT
// Narrow paragraphs expose styled inline runs sharing and wrapping a line.
const tail = 'to change the paper size, margins, heading scale, table colors, or code treatment. Keep local image references next to the document.';
export const inlineExpected = `Edit print.css ${tail} After the paragraph.`;
const cases = [
  ['plain', `<p>Edit print.css ${tail}</p>`, ''],
  ['unstyled-span', `<p>Edit <span>print.css</span> ${tail}</p>`, ''],
  ['code', `<p>Edit <code>print.css</code> ${tail}</p>`, ''],
  ['color', `<p>Edit <code>print.css</code> ${tail}</p>`, 'code {color:#ab391c}'],
  ['background', `<p>Edit <code>print.css</code> ${tail}</p>`, 'code {background:#eee9da}'],
  ['padding', `<p>Edit <code>print.css</code> ${tail}</p>`, 'code {padding:1pt 3pt}'],
  ['different-font', `<p>Edit <code>print.css</code> ${tail}</p>`, "code {font-family:'DM Serif Display';font-size:9pt}"],
  ['decorated', `<p>Edit <code>print.css</code> ${tail}</p>`, "code {font-family:'DM Serif Display';font-size:9pt;padding:1pt 3pt;background:#eee9da}"],
  ['long-inline', `<p>Edit <span>print.css ${tail}</span></p>`, 'span {color:#ab391c}'],
  ['collapsed-spaces', `<p>  Edit <span> print.css </span>  ${tail.replaceAll(' ', '  ')}  </p>`, 'span {background:#eee9da}'],
  ['helvetica', `<p>Edit <span>print.css</span> ${tail}</p>`, '* {font-family:Helvetica} span {color:#ab391c}'],
  ['times', `<p>Edit <span>print.css</span> ${tail}</p>`, '* {font-family:Times-Roman} span {color:#ab391c}'],
];
export const inlineFixtures = cases.map(([name, html, rule]) => ({
  name: 'inline-' + name, pages: 1, html: html + '<p>After the paragraph.</p>',
  css: '@page {size:240pt 420pt;margin:20pt} body {font-family:Inter;font-size:10pt;line-height:15pt} '
    + '* {margin:0;padding:0} p {margin-bottom:12pt} ' + rule,
}));
