// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { el, component, document, style, toHtml, StyleSheet, componentStyles, renderDocument,
  Document, Paragraph, Strong, Heading, Section, Stack, Row, LayoutGrid, Image, Link, Box, Fragment } from 'fullbleed/ui';

const fixture = JSON.parse(await readFile(new URL('./fixtures/component-authoring.json', import.meta.url), 'utf8'));
const fromSpec = spec => Array.isArray(spec) ? spec.map(fromSpec) : spec && typeof spec === 'object'
  ? el(spec.tag, spec.props, ...(spec.children ?? []).map(fromSpec)) : spec;
for (const c of fixture.cases) test(`portable HTML: ${c.name}`, () => {
  const tree = fromSpec(c.node);
  assert.equal(toHtml(tree), c.html);
  assert.equal(toHtml(tree), c.html);
});
for (const c of fixture.styles) test(`portable CSS: ${c.name}`, () => assert.equal(style(...c.input).toCss(), c.css));

test('plain function components and document fragments escape data', () => {
  const Line = component(({ label, paid }) => [el('h1', null, label), paid && el('p', null, 'Paid')]);
  const report = document({ title: 'Customer <report>' }, Line({ label: 'Alice & Bob', paid: false }));
  assert.match(report.toHtml(), /<title>Customer &lt;report&gt;<\/title>/);
  assert.match(report.toHtml(), /<h1>Alice &amp; Bob<\/h1>/);
  assert(!report.toHtml().includes('false'));
});
test('generator children are captured once and lists are copied', () => {
  let calls = 0;
  function* rows() { for (const label of ['One', 'Two']) { calls++; yield el('p', null, label); } }
  const source = [rows()];
  const tree = el('div', null, source);
  source.push('later');
  assert.equal(calls, 2);
  assert.equal(toHtml(tree), '<div><p>One</p><p>Two</p></div>');
  assert.equal(toHtml(tree), '<div><p>One</p><p>Two</p></div>');
  assert.equal(calls, 2);
});
test('authoring errors never become markup or object representations', () => {
  for (const tag of ['', 'p><script', 'div onclick=x', 'div/']) assert.throws(() => el(tag, null), /tag name/);
  for (const key of ['x y', 'x=y', 'x>y', 'x\0y', 'x" y="']) assert.throws(() => toHtml(el('p', { [key]: 'x' })), /attribute name/);
  for (const child of [{ x: 1 }, new Set([1]), new Map(), () => 'x', new Uint8Array([1]), NaN, Infinity])
    assert.throws(() => el('p', null, child), /component child/);
  assert.throws(() => el('br', null, 'lost'), /cannot have children/);
  const cycle = []; cycle.push(cycle);
  assert.throws(() => el('p', null, cycle), /Cyclic/);
  assert.throws(() => style(cycle), /Cyclic/);
  assert.throws(() => style('color: red; content: "open'), /Incomplete/);
});
test('styles preserve case-sensitive custom properties and do not mutate their base', () => {
  const base = style({ fontWeight: 600, '--Brand_Color': '#123' });
  assert.equal(style(base, { font_weight: 700 }).toCss(), '--Brand_Color: #123; font-weight: 700;');
  assert.equal(base.toCss(), 'font-weight: 600; --Brand_Color: #123;');
});
test('CommonJS and ESM use the same component objects', () => {
  const cjs = createRequire(import.meta.url)('fullbleed/ui');
  assert.equal(cjs.el, el);
  assert.equal(cjs.toHtml(el('p', null, 'ESM')), '<p>ESM</p>');
  assert.equal(toHtml(cjs.el('p', null, 'CJS')), '<p>CJS</p>');
});

test('named components compose rich children, layout props, classes and explicit overrides', () => {
  const text = Paragraph('Hello ', Strong('A & B'), ', ', 0, false);
  assert.equal(text.toHtml(), '<p>Hello <strong>A &amp; B</strong>, 0</p>');
  assert.equal(Paragraph({ children: 'Same' }).toHtml(), Paragraph('Same').toHtml());
  assert.match(Stack({ as: 'section', gap: '12pt', className: 'invoice', style: { gap: '20pt' } }, text).toHtml(),
    /^<section style="display: flex; flex-direction: column; gap: 20pt;" class="ui-stack invoice">/);
  assert.match(Row({ align: 'start', justify: 'center', wrap: false }, text).toHtml(), /flex-wrap: nowrap/);
  assert.match(LayoutGrid({ columns: 3, gap: '8pt' }, text).toHtml(), /grid-template-columns: 1fr 1fr 1fr/);
  assert.equal(Section({ heading: ['A ', Strong('title')], headingLevel: 1 }, 'Body').toHtml(),
    '<section class="ui-section"><h1 class="ui-heading">A <strong>title</strong></h1>Body</section>');
  assert.equal(toHtml(Fragment(false, Paragraph('A'), [null, 'B'])), '<p>A</p>B');
  assert.equal(Image({ src: 'assets/logo.png', alt: '' }).toHtml(), '<img src="assets/logo.png" alt="">');
  assert.equal(Link({ href: 'https://example.com?a=1&b=2' }, 'Read').toHtml(), '<a href="https://example.com?a=1&amp;b=2">Read</a>');
});

test('elements, documents and stylesheets capture mutable inputs at construction', () => {
  const map = { color: 'red' }, declarations = style({ fontWeight: 500 });
  const child = Paragraph({ style: [map, declarations] }, 'Snapshot');
  const rules = { '.value': { color: 'green' } }, fragments = [new StyleSheet(rules)];
  const doc = Document({ styles: fragments }, child);
  map.color = 'blue'; declarations.merge({ fontWeight: 900 }); rules['.value'].color = 'purple'; fragments.push('p { color: black; }');
  assert.equal(child.toHtml(), '<p style="color: red; font-weight: 500;">Snapshot</p>');
  assert.equal(doc.toCss(), componentStyles() + '\n.value { color: green; }');
  assert(doc.toCss({ '.value': { color: 'gold' } }).endsWith('.value { color: gold; }'));
  assert(!doc.toHtml().includes('<style'));
  assert.equal(Document({ includeComponentStyles: false, styles: rules }).toCss(), '.value { color: purple; }');
});

test('invalid authoring fails close to its source', () => {
  assert.throws(() => Paragraph({ children: 'One' }, 'Two'), /props.children/);
  assert.throws(() => Box(Document('Nested')), /outer document/);
  assert.throws(() => Paragraph(Promise.resolve('Async')), /component child/);
  assert.throws(() => Paragraph({ title: NaN }), /finite scalar/);
  assert.throws(() => Paragraph({ ref: {} }), /refs/);
  assert.throws(() => Heading({ level: true }, 'Invalid'), /integer/);
  assert.throws(() => Stack({ as: 'script' }), /Unsupported/);
  assert.throws(() => Row({ wrap: 'wrap' }), /boolean/);
  for (const columns of [0, -1, 1.5, true, '', NaN]) assert.throws(() => LayoutGrid({ columns }), /columns/);
  assert.throws(() => Image({ src: 'x' }), /alt/);
  assert.throws(() => Image({ src: 'x', alt: 'Logo' }, 'Lost'), /cannot have children/);
  assert.throws(() => Link({}, 'Lost'), /href/);
  assert.throws(() => style({ margin: [1, {}] }), /Invalid style/);
  assert.throws(() => new StyleSheet({ '@media print': { p: { color: 'red' } } }), /Invalid style/);
  const cycle = []; cycle.push(cycle);
  assert.throws(() => new StyleSheet(cycle), /Cyclic/);
  assert.throws(() => Document({ font: 'Inter' }), /Unknown Document/);
  assert.equal(el('p', { constructor: 'safe', toString: '<escaped>' }).toHtml(),
    '<p constructor="safe" toString="&lt;escaped&gt;"></p>');
});

test('document adapter preserves renderer inputs, binding, results and errors', async () => {
  const signal = new AbortController().signal, fonts = [new Uint8Array([1])], assets = { logo: new Uint8Array([2]) };
  const result = { pages: 1, pdf: new Uint8Array([3]), missingGlyphs: 0 };
  const doc = Document({ styles: { p: { color: 'red' } } }, Paragraph('Invoice'));
  const renderer = { marker: true, renderPdf(input) {
    assert.equal(this.marker, true);
    assert.equal(input.html, doc.toHtml());
    assert.equal(input.css, doc.toCss({ p: { color: 'blue' } }));
    assert.equal(input.signal, signal); assert.equal(input.fonts, fonts); assert.equal(input.assets, assets);
    assert.equal(input.defaultStyles, false); assert.equal(input.previewDpi, 96);
    return Promise.resolve(result);
  } };
  assert.equal(await doc.renderPdf(renderer, { styles: { p: { color: 'blue' } }, signal, fonts, assets,
    defaultStyles: false, previewDpi: 96 }), result);
  const error = new Error('Renderer failed');
  await assert.rejects(renderDocument(Paragraph('Recover'), () => Promise.reject(error)), actual => actual === error);
  assert.throws(() => renderDocument(doc, renderer, { html: 'Override' }), /owns html and css/);
  assert.throws(() => renderDocument(doc), /explicit renderPdf/);
});

test('styled HTML export embeds document CSS once in cascade order without changing legacy export', () => {
  const doc = Document({ title: 'Order & copy', styles: { '.notice': { color: 'green' } } },
    Stack(Paragraph({ className: 'notice', style: { fontWeight: 700 } }, 'Ready')));
  const legacy = doc.toHtml(), css = doc.toCss();
  const html = doc.toHtml({ includeStyles: true, styles: { '.notice': { color: 'blue' } } });
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert(html.includes(`<style>${css}\n.notice { color: blue; }</style></head>`));
  assert(html.includes('<title>Order &amp; copy</title>'));
  assert(html.includes('style="font-weight: 700;"'));
  assert.equal(toHtml(doc, { includeStyles: true }), doc.toHtml({ includeStyles: true }));
  assert.equal(doc.toHtml(), legacy);
  assert.equal(doc.toCss(), css);
  assert(!legacy.includes('<style>'));
  assert(!Document({ includeComponentStyles: false }, 'Plain').toHtml({ includeStyles: true }).includes('<style>'));
});

test('unstyled export removes nested CSS sources and inline attributes while preserving content and classes', () => {
  const tree = Box({ className: 'custom', style: { padding: '12pt' } },
    el('STYLE', null, '.custom { color:red }'),
    el('link', { REL: 'alternate\tStyleSheet', href: 'theme.css' }),
    el('link', { rel: 'icon', href: 'icon.png' }),
    el('p', { STYLE: 'color:red', className: 'note', 'data-state': 'ready' }, 'A & B'));
  const legacy = tree.toHtml();
  assert.equal(tree.toHtml({ includeStyles: false }),
    '<div class="ui-box custom"><link rel="icon" href="icon.png"><p class="note" data-state="ready">A &amp; B</p></div>');
  const doc = Document({ styles: '.note { color:blue }' }, tree);
  assert(!/\bstyle[= >]|stylesheet|theme\.css/i.test(doc.toHtml({ includeStyles: false })));
  assert.equal(tree.toHtml(), legacy);
  assert(doc.toCss().includes('.note { color:blue }'));
});

test('fragment export collects one stylesheet for ordered children and supports CommonJS objects', () => {
  let consumed = 0;
  function* children() { consumed++; yield Paragraph({ className: 'note' }, 'One'); yield Strong('Two'); }
  const html = toHtml(children(), { includeStyles: true, styles: '.note { color:blue }' });
  assert.equal(consumed, 1);
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert(html.endsWith('<p class="note">One</p><strong>Two</strong>'));
  const cjs = createRequire(import.meta.url)('fullbleed/ui');
  assert.equal(cjs.toHtml(cjs.Paragraph({ style: 'color:red' }, 'CJS'), { includeStyles: false }), '<p>CJS</p>');
});

test('generated style text cannot terminate its HTML element', () => {
  const css = '.note::before { content: "</StYle><script>bad()</script>"; }';
  const html = Document({ styles: css }, Paragraph({ className: 'note' }, 'Text')).toHtml({ includeStyles: true });
  assert.equal((html.match(/<\/style>/gi) ?? []).length, 1);
  assert(html.includes('content: "<\\/StYle><script>bad()</script>"'));
  const media = '@media (width < 600px) { .note { color:red } }';
  assert(Document({ styles: media }, 'Text').toHtml({ includeStyles: true }).includes(media));
});

test('HTML export rejects misspelled and contradictory options', () => {
  const node = Paragraph('Text'), doc = Document(node);
  for (const options of [null, true, [], { include_styles: true }, { includeStyles: 'yes' },
    { styles: 'p{}' }, { includeStyles: false, styles: 'p{}' }]) {
    assert.throws(() => node.toHtml(options), TypeError);
    assert.throws(() => doc.toHtml(options), TypeError);
    assert.throws(() => toHtml([node], options), TypeError);
  }
});
