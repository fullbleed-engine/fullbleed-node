// SPDX-License-Identifier: MIT
import { useMemo, useState } from 'react';
import { usePdfPreview } from './usePdfPreview';
import invoiceHtml from './invoice.html?raw';
import invoiceCss from './invoice.css?raw';
import reportHtml from './report.html?raw';
import reportCss from './report.css?raw';

const defaults = { invoice: { html: invoiceHtml, css: invoiceCss }, report: { html: reportHtml, css: reportCss } };
type Design = keyof typeof defaults;
const assetBaseUrl = new URL('fullbleed/', new URL(import.meta.env.BASE_URL, location.href)).href;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function DocumentEditor() {
  const [design, setDesign] = useState<Design>('invoice');
  const [templates, setTemplates] = useState(defaults);
  const [customer, setCustomer] = useState('Maple & Finch');
  const [reference, setReference] = useState('NS-1042');
  const [ink, setInk] = useState('#17382e');
  const [autoPreview, setAutoPreview] = useState(true);
  const template = templates[design];
  const inputError = !template.html.trim() ? 'Enter document HTML before generating.'
    : design === 'invoice' && (!customer.trim() || !reference.trim()) ? 'Enter a customer name and invoice reference.'
    : design === 'invoice' && !/^#[\da-f]{6}$/i.test(ink) ? 'Enter a six-digit ink color, such as #17382e.' : '';
  const input = useMemo(() => {
    const values: Record<string, string> = { customer: customer.trim(), reference: reference.trim() };
    const valid = design !== 'invoice' || (values.customer && values.reference && /^#[\da-f]{6}$/i.test(ink));
    return {
      html: valid ? template.html.replace(/{{(customer|reference)}}/g, (_, key: string) => escapeHtml(values[key])) : '',
      css: template.css.replaceAll('{{ink}}', /^#[\da-f]{6}$/i.test(ink) ? ink : '#17382e'),
      previewDpi: 96, maxPages: 20, timeoutMs: 30_000,
    };
  }, [template, customer, reference, ink, design]);
  const pdf = usePdfPreview(input, assetBaseUrl, { auto: autoPreview });
  const filename = design === 'invoice' ? `invoice-${reference.replace(/[^\w-]+/g, '-').slice(0, 32)}.pdf` : 'community-report.pdf';
  const pending = pdf.status === 'queued' || pdf.status === 'rendering';
  const editTemplate = (field: 'html' | 'css', value: string) => setTemplates(previous => ({
    ...previous, [design]: { ...previous[design], [field]: value },
  }));
  const messages: Record<string, string> = {
    MISSING_GLYPHS: 'Some characters need another font. Add font bytes to the input or edit the text.',
    ENGINE_LOAD_FAILED: 'The PDF runtime could not load. Check that all runtime files were deployed.',
    VERSION_MISMATCH: 'The app and runtime versions differ. Rebuild and deploy the complete project.',
    TIMEOUT: 'This document took too long. Reduce its size or generate it again.',
  };
  let status = 'Generate a PDF when you are ready.';
  if (pdf.status === 'queued') status = 'Preview updates after you pause typing.';
  if (pdf.status === 'rendering') status = 'Rendering locally. The first preview also loads the engine and fonts.';
  if (pdf.status === 'cancelled') status = 'Cancelled. Edit a field or choose Generate PDF to continue.';
  if (pdf.status === 'error') status = inputError ? inputError
    : messages[pdf.error!.code] ?? pdf.error!.message;
  if (pdf.result) status = `Ready. ${pdf.result.pages} ${pdf.result.pages === 1 ? 'page' : 'pages'} · ${Math.ceil(pdf.result.bytes / 1024)} KiB. Your PDF is ready to download.`;

  return <>
    <div className="workspace">
      <section className="controls" aria-labelledby="controls-title">
        <div className="panel-heading"><span className="step">01</span><h2 id="controls-title">Change the details</h2></div>
        <label htmlFor="kind">Start with a design</label>
        <select id="kind" value={design} onChange={event => setDesign(event.target.value as Design)}>
          <option value="invoice">Studio invoice</option><option value="report">Community report · 3 pages</option>
        </select>
        {design === 'invoice' && <>
          <label htmlFor="customer">Customer name</label>
          <input id="customer" value={customer} maxLength={100} onChange={event => setCustomer(event.target.value)} />
          <label htmlFor="reference">Invoice reference</label>
          <input id="reference" value={reference} maxLength={48} onChange={event => setReference(event.target.value)} />
          <label htmlFor="accent">Ink color</label>
          <div className="color-row"><input id="accent" type="color" value={ink} maxLength={7} pattern="#[0-9a-fA-F]{6}"
            ref={element => { if (element && element.type !== 'color') element.classList.add('color-text'); }}
            onChange={event => setInk(event.target.value)} />
            <span>{ink.toUpperCase()}</span><span className="color-hint">Your print palette</span></div>
        </>}
        <p className="sample-note">{design === 'invoice' ? 'Fictional invoice. Items and amounts are fixed for this example.' : 'A three-page report. All organizations, records and amounts are fictional.'}</p>
        <label className="auto-toggle"><input id="auto-preview" type="checkbox" checked={autoPreview} onChange={event => setAutoPreview(event.target.checked)} />Update automatically</label>
        <div className="actions">
          <button id="generate" onClick={() => { void pdf.generate(); }}>Generate PDF <span aria-hidden="true">→</span></button>
          {pending && <button id="cancel" className="secondary" onClick={pdf.cancel}>Cancel</button>}
        </div>
        <p id="status" role="status" aria-live="polite" className={pdf.status === 'error' ? 'error' : ''}>{status}</p>
        <div className="local-note"><span className="local-dot" aria-hidden="true" /><p><strong>Local rendering. Your document.</strong><br />{autoPreview ? 'Changes render after a short pause.' : 'Choose Generate PDF to apply your changes.'} Your document inputs stay in this browser.</p></div>
      </section>
      <section className="preview-panel" aria-labelledby="preview-title">
        <div className="preview-toolbar"><div><span className="step">02</span><h2 id="preview-title">The actual PDF</h2>
          <span id="page-count">{pdf.result && `${pdf.result.pages} ${pdf.result.pages === 1 ? 'page' : 'pages'}`}</span></div>
          {pdf.result ? <a id="download" className="button" href={pdf.result.url} download={filename}>Download PDF <span aria-hidden="true">↓</span></a>
            : <button id="download" disabled>Download PDF <span aria-hidden="true">↓</span></button>}
        </div>
        <div id="preview" className="preview-area" aria-busy={pending}>
          {pdf.result ? pdf.result.previews.map((url, index) => <img key={url} src={url} alt={`Rendered PDF, page ${index + 1} of ${pdf.result!.pages}`} />)
            : <div className="placeholder"><div className="paper-icon" aria-hidden="true" /><p>{pending ? 'Making your document…' : 'Your next preview will appear here.'}</p></div>}
        </div>
      </section>
    </div>
    <details id="template-editor" className="template-editor">
      <summary>Edit the HTML &amp; CSS</summary>
      <p className="editor-note">Paste your own print template. {autoPreview ? 'Changes update the PDF automatically.' : 'Choose Generate PDF to apply your changes.'} Invoice values use <code>{'{{customer}}'}</code>, <code>{'{{reference}}'}</code>, and <code>{'{{ink}}'}</code>. These edits last until reload.</p>
      <div className="editor-grid">
        <div><label htmlFor="html-source">Document HTML</label><textarea id="html-source" value={template.html} spellCheck={false} onChange={event => editTemplate('html', event.target.value)} /></div>
        <div><label htmlFor="css-source">Print CSS</label><textarea id="css-source" value={template.css} spellCheck={false} onChange={event => editTemplate('css', event.target.value)} /></div>
      </div>
      <div className="editor-actions"><button id="reset-source" className="secondary" onClick={() => setTemplates(previous => ({ ...previous, [design]: defaults[design] }))}>Reset this template</button>
        <p>Keep templates in the downloaded project's <code>src/</code> directory.</p></div>
    </details>
  </>;
}

export default function App() {
  const [open, setOpen] = useState(true);
  return <>
    <header className="site-header"><a className="wordmark" href="https://www.fullbleed.dev/">fullbleed<span>.</span></a>
      <span className="header-note">REACT + TYPESCRIPT / MIT</span>
      <a className="docs-link" href="https://docs.fullbleed.dev/guides/browser-pdf/">Browser guide <span aria-hidden="true">↗</span></a></header>
    <main>
      <div className="intro"><p className="eyebrow"><span />YOUR FORM → YOUR PDF</p>
        <h1>A change in your form.<br />A change on the page.</h1>
        <p className="lede">Edit the details. Watch the actual PDF update.<br className="wide-only" /> A React starter with HTML/CSS templates and local rendering.</p></div>
      <div className="workspace-switch"><span><span className="live-dot" />{open ? 'Document editor' : 'Editor closed'}</span>
        <button id="toggle-editor" className="text-button" onClick={() => setOpen(value => !value)}>{open ? 'Close editor' : 'Open editor'}</button></div>
      {open ? <DocumentEditor /> : <section className="closed-panel"><h2>Ready when you are.</h2><p>Open the editor to start a fresh document.</p></section>}
      <footer><p>Built with Fullbleed. MIT licensed, including commercial use.</p><a href="https://github.com/fullbleed-engine/fullbleed-node/tree/main/examples/react">Get the React source ↗</a></footer>
    </main>
  </>;
}
