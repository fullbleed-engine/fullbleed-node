// SPDX-License-Identifier: MIT
'use strict';

// Pure authoring helpers: importing this module never starts a renderer or
// accesses Node, the DOM, the network, the filesystem, or system fonts.
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const BOOLEAN = new Set(('allowfullscreen async autofocus autoplay checked controls default defer disabled ' +
  'formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate ' +
  'open playsinline readonly required reversed selected').split(' '));
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
})[c]);
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function flatten(children) {
  const out = [], active = new Set();
  function visit(child) {
    if (child == null || typeof child === 'boolean') return;
    if (child instanceof DocumentArtifact) throw new TypeError('A Document must be the outer document, not a component child');
    if (child instanceof Element || typeof child === 'string' || typeof child === 'bigint') {
      out.push(child); return;
    }
    if (typeof child === 'number' && Number.isFinite(child)) { out.push(child); return; }
    if (typeof child === 'object' && !(child instanceof Set) && !(child instanceof Map) &&
        !ArrayBuffer.isView(child) && typeof child[Symbol.iterator] === 'function') {
      if (active.has(child)) throw new TypeError('Cyclic component children');
      active.add(child);
      try { for (const item of child) visit(item); } finally { active.delete(child); }
      return;
    }
    throw new TypeError('Unsupported component child. Call components and format data explicitly; use ordered children.');
  }
  visit(children);
  return out;
}

function attrName(name) {
  const aliases = { className: 'class', class_name: 'class', class_: 'class', htmlFor: 'for', for_: 'for' };
  const normalized = Object.hasOwn(aliases, name) ? aliases[name] : name.replaceAll('_', '-');
  if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(normalized)) throw new TypeError(`Invalid HTML attribute name: ${name}`);
  return normalized;
}

function snapshotProps(props) {
  const result = Object.create(null);
  const names = new Set();
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key') continue; // Static documents do not reconcile keyed children.
    if (key === 'ref') throw new TypeError('Component refs are not supported in static documents');
    const name = attrName(key);
    if (names.has(name)) throw new TypeError(`Duplicate HTML attribute: ${name}`);
    names.add(name);
    if (name === 'style') result[key] = typeof value === 'string' ? value.trim() : style(value).toCss();
    else if (value == null || ['string', 'boolean', 'bigint'].includes(typeof value) ||
        (typeof value === 'number' && Number.isFinite(value))) result[key] = value;
    else throw new TypeError(`Attribute ${name} must be a finite scalar or a style value`);
  }
  return Object.freeze(result);
}

function attrs(props) {
  const output = [];
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    const name = attrName(key);
    if (name === 'style') {
      if (value) output.push(`${name}="${escape(value)}"`);
    } else if (typeof value === 'boolean' && BOOLEAN.has(name.toLowerCase())) {
      if (value) output.push(name);
    } else if (['string', 'number', 'boolean', 'bigint'].includes(typeof value)) {
      output.push(`${name}="${escape(value)}"`);
    } else {
      throw new TypeError(`Attribute ${name} must be a scalar or a style value`);
    }
  }
  return output.length ? ' ' + output.join(' ') : '';
}

class Element {
  constructor(tag, props = {}, children) {
    if (typeof tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(tag)) throw new TypeError(`Invalid HTML tag name: ${tag}`);
    if (!plain(props)) throw new TypeError('Element props must be a plain object');
    const extracted = extractChildren(props, children);
    this.tag = tag;
    this.props = snapshotProps(extracted.props);
    this.children = Object.freeze(flatten(extracted.children));
    if (VOID.has(tag.toLowerCase()) && this.children.length) throw new TypeError(`Void element ${tag} cannot have children`);
    Object.freeze(this);
  }
  toHtml() {
    const start = `<${this.tag}${attrs(this.props)}>`;
    return VOID.has(this.tag.toLowerCase()) ? start : start + this.children.map(render).join('') + `</${this.tag}>`;
  }
}

function render(node) { return node instanceof Element ? node.toHtml() : escape(node); }
function extractChildren(props, positional) {
  const { children, ...rest } = props;
  if (Object.hasOwn(props, 'children') && positional?.length)
    throw new TypeError('Use props.children or positional children, not both');
  return { props: rest, children: Object.hasOwn(props, 'children') ? [children] : (positional ?? []) };
}
function el(tag, props, ...children) { return new Element(tag, props ?? {}, children); }
function component(fn) {
  if (typeof fn !== 'function') throw new TypeError('A component must be a function');
  return fn;
}
function toHtml(node) {
  if (node instanceof DocumentArtifact) return node.toHtml();
  return flatten([node]).map(render).join('');
}

class DocumentArtifact {
  constructor(options = {}, children) {
    if (!plain(options)) throw new TypeError('Document options must be a plain object');
    const extracted = extractChildren(options, children);
    const { title = 'fullbleed document', lang = 'en', page = 'LETTER', margin = '0.5in', bootstrap = false,
      styles, includeComponentStyles = true, ...unknown } = extracted.props;
    delete unknown.key;
    if (Object.keys(unknown).length) throw new TypeError(`Unknown Document option: ${Object.keys(unknown)[0]}`);
    if ([title, lang, page, margin].some(value => typeof value !== 'string')) throw new TypeError('Document metadata must be strings');
    if (typeof bootstrap !== 'boolean' || typeof includeComponentStyles !== 'boolean') throw new TypeError('Document flags must be booleans');
    this.title = title;
    this.lang = lang.trim() || 'en';
    this.page = page;
    this.margin = margin;
    this.styles = new StyleSheet(styles);
    this.includeComponentStyles = includeComponentStyles;
    this.root = el('main', { class_name: 'fb-document-root report-root' + (bootstrap ? ' fb-bootstrap-enabled' : ''),
      data_fb_role: 'document-root', data_fb_page: page }, extracted.children);
    Object.freeze(this);
  }
  toHtml() {
    return '<!doctype html>' + `<html lang="${escape(this.lang)}"><head><meta charset="utf-8" />` +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      `<title>${escape(this.title)}</title></head><body>${this.root.toHtml()}</body></html>`;
  }
  toCss(...overrides) {
    return new StyleSheet(this.includeComponentStyles && componentStyles(), this.styles, ...overrides).toCss();
  }
  renderPdf(renderer, options) { return renderDocument(this, renderer, options); }
}
function Document(...args) {
  const { props, children } = argumentsFor(args);
  return new DocumentArtifact(props, children);
}
const document = Document;

function renderDocument(node, renderer, options = {}) {
  if (!plain(options)) throw new TypeError('Render options must be a plain object');
  const { styles, ...rest } = options;
  if (Object.hasOwn(rest, 'html') || Object.hasOwn(rest, 'css'))
    throw new TypeError('Document rendering owns html and css; use styles for CSS overrides');
  const doc = node instanceof DocumentArtifact ? node : Document(node);
  const input = { ...rest, html: doc.toHtml(), css: doc.toCss(styles) };
  if (typeof renderer === 'function') return renderer(input);
  if (renderer && typeof renderer.renderPdf === 'function') return renderer.renderPdf(input);
  throw new TypeError('Pass an explicit renderPdf function, render queue or browser renderer');
}

function declarations(fragment) {
  const output = [], blocks = [], pairs = { '(': ')', '[': ']', '{': '}' };
  let chunk = '', quote = null, escaped = false, comment = false;
  for (let i = 0; i < fragment.length; i++) {
    const c = fragment[i];
    if (comment) {
      if (fragment.startsWith('*/', i)) { comment = false; i++; }
    } else if (escaped) { chunk += c; escaped = false;
    } else if (c === '\\') { chunk += c; escaped = true;
    } else if (quote) { chunk += c; if (c === quote) quote = null;
    } else if (fragment.startsWith('/*', i)) { chunk += ' '; comment = true; i++;
    } else if (c === '"' || c === "'") { quote = c; chunk += c;
    } else if (Object.hasOwn(pairs, c)) { blocks.push(pairs[c]); chunk += c;
    } else if (blocks.length && c === blocks.at(-1)) { blocks.pop(); chunk += c;
    } else if (c === ';' && !blocks.length) { output.push(chunk); chunk = '';
    } else { chunk += c; }
  }
  if (quote || blocks.length || comment || escaped) throw new TypeError('Incomplete inline-style declaration');
  output.push(chunk);
  return output.filter(value => value.trim()).map(value => {
    const colon = value.indexOf(':');
    if (colon < 1) throw new TypeError('Inline-style declaration requires a property and colon');
    return [value.slice(0, colon), value.slice(colon + 1)];
  });
}

function propName(name) {
  const text = name.trim();
  return text.startsWith('--') ? text : text.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replaceAll('_', '-').toLowerCase();
}
class Style {
  #props = new Map();
  constructor(...fragments) { this.merge(...fragments); }
  merge(...fragments) {
    const active = new Set();
    const set = (name, value) => {
      const prop = propName(name);
      if (!prop) throw new TypeError('Inline-style property cannot be empty');
      if (value == null || value === false) return;
      if (Array.isArray(value)) {
        const items = value.filter(item => item != null);
        if (items.some(item => typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item))))
          throw new TypeError(`Invalid style value for ${prop}`);
        value = items.join(' ');
      }
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new TypeError(`Invalid style value for ${prop}`);
      value = String(value).trim();
      if (!value) return;
      this.#props.delete(prop);
      this.#props.set(prop, value);
    };
    const merge = fragment => {
      if (fragment == null || fragment === false) return;
      if (fragment instanceof Style) { for (const [key, value] of fragment.entries()) set(key, value); }
      else if (typeof fragment === 'string') { for (const [key, value] of declarations(fragment)) set(key, value); }
      else if (Array.isArray(fragment)) {
        if (active.has(fragment)) throw new TypeError('Cyclic style fragments');
        active.add(fragment);
        try { for (const part of fragment) merge(part); } finally { active.delete(fragment); }
      } else if (plain(fragment)) { for (const [key, value] of Object.entries(fragment)) set(key, value); }
      else throw new TypeError('Style fragments must be CSS strings, maps, arrays or Style values');
    };
    for (const fragment of fragments) merge(fragment);
    return this;
  }
  entries() { return Array.from(this.#props); }
  toCss() { return this.#props.size ? this.entries().map(([key, value]) => `${key}: ${value}`).join('; ') + ';' : ''; }
}
function style(...fragments) { return new Style(...fragments); }

class StyleSheet {
  #css;
  constructor(...fragments) {
    const output = [], active = new Set();
    const append = fragment => {
      if (fragment == null || fragment === false) return;
      if (fragment instanceof StyleSheet) output.push(fragment.toCss());
      else if (typeof fragment === 'string') output.push(fragment.trim());
      else if (Array.isArray(fragment)) {
        if (active.has(fragment)) throw new TypeError('Cyclic stylesheet fragments');
        active.add(fragment);
        try { for (const part of fragment) append(part); } finally { active.delete(fragment); }
      } else if (plain(fragment)) {
        for (const [selector, declarations] of Object.entries(fragment)) {
          if (!selector.trim()) throw new TypeError('Stylesheet selector cannot be empty');
          output.push(`${selector.trim()} { ${style(declarations).toCss()} }`);
        }
      } else throw new TypeError('Stylesheet fragments must be CSS strings, rule maps, arrays or StyleSheet values');
    };
    for (const fragment of fragments) append(fragment);
    this.#css = output.filter(Boolean).join('\n');
    Object.freeze(this);
  }
  toCss() { return this.#css; }
}

function componentStyles() {
  return new StyleSheet({
    '.ui-stack': { display: 'flex', flexDirection: 'column', gap: '8pt' },
    '.ui-row': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8pt' },
    '.ui-layout-grid': { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8pt' },
    '.ui-inline': { display: 'inline-flex', alignItems: 'center', gap: '4pt' },
    '.ui-center': { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
    '.ui-card': { border: '1px solid #d3ded8', borderRadius: '4pt', padding: '12pt' },
    '.ui-table': { width: '100%', borderCollapse: 'collapse' },
  }).toCss();
}

function argumentsFor(args) {
  const [first, ...rest] = args;
  return plain(first) ? extractChildren(first, rest) : { props: {}, children: args };
}
const CONTAINERS = new Set('div section article aside header footer main nav'.split(' '));
const TEXT_TAGS = new Set('span p strong em small b i u s code pre blockquote h1 h2 h3 h4 h5 h6'.split(' '));
function named(tag, baseClass, allowed, transform) {
  return (...args) => {
    const extracted = argumentsFor(args), props = extracted.props;
    const { as = tag } = props;
    delete props.as;
    if (as !== tag && !allowed?.has(as)) throw new TypeError(`Unsupported ${tag} component tag: ${as}`);
    let selected = as;
    if (transform) selected = transform(props, extracted.children) ?? as;
    const classes = [baseClass, props.className, props.class_name, props.class_, props.class]
      .filter(value => value != null && value !== false);
    if (classes.some(value => typeof value !== 'string')) throw new TypeError('Component classes must be strings');
    for (const name of ['className', 'class_name', 'class_', 'class']) delete props[name];
    if (classes.length) props.className = classes.map(value => value.trim()).filter(Boolean).join(' ');
    return new Element(selected, props, extracted.children);
  };
}
function layout(props, defaults, names) {
  if (names.some(name => props[name] != null)) props.style = style(defaults, props.style);
  for (const name of names) delete props[name];
}
function requireString(props, name) {
  if (typeof props[name] !== 'string') throw new TypeError(`${name} must be an explicit string`);
}
const Text = named('span', null, TEXT_TAGS);
const Paragraph = named('p'), Strong = named('strong'), Emphasis = named('em');
const Header = named('header'), Footer = named('footer'), LineBreak = named('br');
const Link = named('a', null, null, props => { requireString(props, 'href'); });
const Image = named('img', null, null, props => { requireString(props, 'src'); requireString(props, 'alt'); });
const Heading = named('h2', 'ui-heading', null, props => {
  const { level = 2 } = props;
  delete props.level;
  if (!Number.isInteger(level) || level < 1 || level > 6) throw new TypeError('Heading level must be an integer between 1 and 6');
  return `h${level}`;
});
const Section = named('section', 'ui-section', null, (props, children) => {
  const { heading, headingLevel = 2 } = props;
  delete props.heading; delete props.headingLevel;
  if (heading != null) children.unshift(Heading({ level: headingLevel }, heading));
});
const Box = named('div', 'ui-box', CONTAINERS);
const Stack = named('div', 'ui-stack', CONTAINERS, props => {
  layout(props, { display: 'flex', flexDirection: 'column', gap: props.gap, alignItems: props.align }, ['gap', 'align']);
});
const Row = named('div', 'ui-row', CONTAINERS, props => {
  if (props.wrap != null && typeof props.wrap !== 'boolean') throw new TypeError('Row wrap must be a boolean');
  layout(props, { display: 'flex', gap: props.gap, alignItems: props.align, justifyContent: props.justify,
    flexWrap: props.wrap == null ? null : props.wrap ? 'wrap' : 'nowrap' }, ['gap', 'align', 'justify', 'wrap']);
});
const LayoutGrid = named('div', 'ui-layout-grid', CONTAINERS, props => {
  let { columns } = props;
  if (columns != null && !(typeof columns === 'string' && columns.trim()) && !(Number.isSafeInteger(columns) && columns > 0))
    throw new TypeError('LayoutGrid columns must be a positive integer or CSS track string');
  if (typeof columns === 'number') columns = Array.from({ length: columns }, () => '1fr').join(' ');
  layout(props, { display: 'grid', gridTemplateColumns: columns, gap: props.gap }, ['columns', 'gap']);
});
const Inline = named('span', 'ui-inline', new Set(['span', 'div']));
const Center = named('div', 'ui-center', CONTAINERS), Card = named('section', 'ui-card', CONTAINERS);
const Divider = named('hr', 'ui-divider');
const List = named('ul', 'ui-list', new Set(['ul', 'ol'])), ListItem = named('li', 'ui-list-item');
const Table = named('table', 'ui-table'), TableCaption = named('caption', 'ui-table-caption');
const THead = named('thead', 'ui-thead'), TBody = named('tbody', 'ui-tbody'), TFoot = named('tfoot', 'ui-tfoot');
const Tr = named('tr', 'ui-tr'), Th = named('th', 'ui-th'), Td = named('td', 'ui-td');
function Fragment(...args) {
  const { props, children } = argumentsFor(args);
  delete props.key;
  if (Object.keys(props).length) throw new TypeError('Fragment accepts only children');
  return Object.freeze(flatten(children));
}

/** Evaluate synchronous components. The explicit runtime is independent of React. */
function createElement(type, props, ...children) {
  if (props != null && !plain(props)) throw new TypeError('Component props must be a plain object');
  const extracted = extractChildren(props ?? {}, children);
  delete extracted.props.key;
  if (Object.hasOwn(extracted.props, 'ref')) throw new TypeError('Component refs are not supported in static documents');
  if (typeof type === 'string') return new Element(type, extracted.props, extracted.children);
  if (typeof type !== 'function') throw new TypeError('Component type must be a tag name or synchronous function');
  // Match the useful React convention: no children prop when none were supplied,
  // a single child as-is, and an array for multiple children.
  if (Object.hasOwn(props ?? {}, 'children') || children.length)
    extracted.props.children = Object.hasOwn(props ?? {}, 'children') ? props.children : children.length === 1 ? children[0] : children;
  const result = type(extracted.props);
  if (result instanceof DocumentArtifact || result instanceof Element) return result;
  const captured = flatten([result]);
  return Object.freeze(captured);
}

module.exports = { Element, DocumentArtifact, Style, StyleSheet, el, component, document, Document, toHtml, style,
  componentStyles, renderDocument, createElement, Fragment, Text, Paragraph, Strong, Emphasis, Link, Image,
  Header, Footer, LineBreak, Heading, Section, Box, Stack, Row, LayoutGrid, Inline, Center, Card, Divider,
  List, ListItem, Table, TableCaption, THead, TBody, TFoot, Tr, Th, Td };
