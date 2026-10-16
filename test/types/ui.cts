import ui = require('fullbleed/ui');
import runtime = require('fullbleed/ui/jsx-runtime');
import development = require('fullbleed/ui/jsx-dev-runtime');
import engine = require('fullbleed');
const Amount = ui.component((value: number) => ui.el('p', null, value));
const html: string = ui.document({ title: 'CJS' }, Amount(12)).toHtml();
const styled: string = ui.Document(Amount(12)).toHtml({ includeStyles: true, styles: 'p { color:navy }' });
const plain: string = ui.toHtml(Amount(12), { includeStyles: false });
// @ts-expect-error Export options also remain checked through CommonJS declarations.
ui.toHtml(Amount(12), { includeStyles: false, styles: 'p {}' });
void [styled, plain];
void html;
// @ts-expect-error Types survive the CommonJS export.
Amount('twelve');
const node: ui.Renderable = runtime.jsx(ui.Paragraph, { children: 'CJS JSX' });
const result: Promise<engine.RenderResult> = ui.renderDocument(development.jsxDEV(ui.Document, { children: node }), engine.renderPdf, { previewDpi: 96 });
// @ts-expect-error CJS renderer options remain typed.
ui.Document('CJS').renderPdf(engine.renderPdf, { previewDpi: '96' });
void result;
