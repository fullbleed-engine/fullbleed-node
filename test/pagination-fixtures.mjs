// SPDX-License-Identifier: MIT
const rows = Array.from({ length: 80 }, (_, i) => `<tr><td>ROW-${String(i + 1).padStart(3, '0')}</td><td>Finding details</td></tr>`).join('');
export const fixtures = ['hidden', 'clip', 'hidden visible', 'visible hidden', 'auto', 'scroll'].map(overflow => ({
  name: 'table-' + overflow.replaceAll(' ', '-'), kind: 'table',
  html: `<h1>Report</h1><table><thead><tr><th>Record</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>`,
  css: `@page { size: A5; margin: 15mm; } body { font: 12pt Helvetica; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1pt solid black; border-radius: 5pt; overflow: ${overflow}; }
    td, th { padding: 6pt; border-bottom: 0.5pt solid #999; }`,
}));
for (const [name, height, pages] of [['break-auto', '', 2], ['break-fixed', 'height: 120pt;', 1]]) {
  fixtures.push({ name, kind: 'break', pages,
    html: '<div class="box"><p>BEFORE</p><p class="next">AFTER</p></div>',
    css: `@page { size: A5; margin: 15mm; } body { font: 12pt Helvetica; }
      p { height: 60pt; margin: 0; } .next { break-before: page; } .box { overflow: hidden; ${height} }`,
  });
}
fixtures.push({ name: 'footnote', kind: 'footnote', pages: 2,
  html: '<div class="lead"></div><section class="clip"><p>First line stays here<br>Second line has notes<span class="fn">first note</span><span class="fn">second note</span></p></section>',
  css: `@page { size: 192px 136px; margin: 8px; @footnote { border-top: 8px solid #111; padding-top: 8px; } }
    html { font-family: Helvetica; font-size: 12px; line-height: 20px; }
    * { margin: 0; box-sizing: border-box; } .lead { width: 176px; height: 72px; }
    p { width: 176px; line-height: 20px; } .clip { overflow: hidden; }
    .fn { float: footnote; footnote-display: inline; footnote-policy: line; }`,
});
