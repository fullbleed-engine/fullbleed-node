import { createRenderer, FullbleedError } from 'fullbleed/browser';
import invoiceTemplate from './invoice.html?raw';
import invoiceCss from './invoice.css?raw';
import reportTemplate from './report.html?raw';
import reportCss from './report.css?raw';
import './style.css';

const $ = id => document.getElementById(id);
const assetBaseUrl = new URL('fullbleed/', new URL(import.meta.env.BASE_URL, location.href));
let renderer;
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const placeholder = $('preview').firstElementChild.cloneNode(true);
if ($('accent').type !== 'color') {
  $('accent').classList.add('color-text');
  $('accent').maxLength = 7;
  $('accent').setAttribute('pattern', '#[0-9a-fA-F]{6}');
  $('color-value').hidden = true;
}
let controller, pdfUrl, filename, previewUrls = [];
const defaults = {
  invoice: { html: invoiceTemplate, css: invoiceCss },
  report: { html: reportTemplate, css: reportCss },
};
const templates = structuredClone(defaults);
function loadSource() {
  const template = templates[$('kind').value];
  $('html-source').value = template.html;
  $('css-source').value = template.css;
}
loadSource();

function clearOutput() {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  pdfUrl = null; previewUrls = [];
  $('download').disabled = true;
  $('page-count').textContent = '';
  $('preview').replaceChildren(placeholder.cloneNode(true));
}
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function markChanged() {
  clearOutput();
  status('Generate a PDF to apply your changes.');
  const invoice = $('kind').value === 'invoice';
  $('invoice-fields').hidden = !invoice;
  $('customer').required = $('reference').required = invoice;
  $('color-value').textContent = $('accent').value.toUpperCase();
  $('sample-note').textContent = invoice ? 'Fictional invoice. Items and amounts are fixed for this example.' : 'A three-page report with tables, charts and print styling. All data is fictional.';
}
function documentInput() {
  const template = templates[$('kind').value];
  if ($('kind').value === 'report') return { ...template, filename: 'community-report.pdf' };
  const customer = $('customer').value.trim();
  const reference = $('reference').value.trim();
  if (!customer || !reference) throw new Error('Enter a customer name and invoice reference.');
  const accent = $('accent').value;
  if (!/^#[\da-f]{6}$/i.test(accent)) throw new Error('Choose a valid ink color.');
  return { html: template.html.replace(/{{(customer|reference)}}/g, (_, key) => escapeHtml({ customer, reference }[key])),
    css: template.css.replaceAll('{{ink}}', accent), filename: 'invoice-' + reference.replace(/[^\w-]+/g, '-').slice(0, 32) + '.pdf' };
}
async function generate(event) {
  event?.preventDefault();
  if (controller) return;
  clearOutput();
  controller = new AbortController();
  $('fields').disabled = $('editor-fields').disabled = $('generate').disabled = $('render-source').disabled = $('reset-source').disabled = true;
  $('cancel').hidden = false;
  $('preview').setAttribute('aria-busy', 'true');
  status('Rendering locally… The first preview also loads the engine and fonts.');
  try {
    const input = documentInput();
    renderer ??= createRenderer({ assetBaseUrl });
    const result = await renderer.renderPdf({ html: input.html, css: input.css, previewDpi: 96, maxPages: 20, timeoutMs: 30_000, signal: controller.signal });
    pdfUrl = URL.createObjectURL(new Blob([result.pdf], { type: 'application/pdf' }));
    filename = input.filename;
    const pages = result.previews.map((bytes, i) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      previewUrls.push(url);
      const image = document.createElement('img');
      image.src = url; image.alt = `Rendered PDF, page ${i + 1} of ${result.pages}`;
      return image;
    });
    $('preview').replaceChildren(...pages);
    $('page-count').textContent = `${result.pages} ${result.pages === 1 ? 'page' : 'pages'}`;
    $('download').disabled = false;
    status(`Ready. ${result.pages} ${result.pages === 1 ? 'page' : 'pages'} · ${Math.ceil(result.pdf.byteLength / 1024)} KiB. Your PDF is ready to download.`);
  } catch (error) {
    const messages = {
      ABORTED: 'Cancelled. You can generate another PDF.',
      MISSING_GLYPHS: 'The bundled fonts do not include every character. Try another name or add a font to the project.',
      TIMEOUT: 'This document took too long. Try again or reduce its size.',
      ENGINE_LOAD_FAILED: 'The PDF runtime could not load. Check that the static files were deployed completely.',
      VERSION_MISMATCH: 'The app and PDF runtime versions differ. Copy and deploy the current runtime files.',
      WORKER_FAILED: 'The PDF worker could not start. Check the hosted files and the site worker policy.',
    };
    status(error instanceof FullbleedError ? messages[error.code] ?? error.message : error.message, error.code !== 'ABORTED');
  } finally {
    controller = null;
    $('fields').disabled = $('editor-fields').disabled = $('generate').disabled = $('render-source').disabled = $('reset-source').disabled = false;
    $('cancel').hidden = true;
    $('preview').setAttribute('aria-busy', 'false');
  }
}
$('design-form').addEventListener('submit', generate);
$('fields').addEventListener('input', markChanged);
$('kind').addEventListener('change', loadSource);
$('editor-fields').addEventListener('input', () => {
  templates[$('kind').value] = { html: $('html-source').value, css: $('css-source').value };
  markChanged();
});
$('reset-source').addEventListener('click', () => {
  templates[$('kind').value] = { ...defaults[$('kind').value] };
  loadSource(); markChanged();
});
$('render-source').addEventListener('click', () => $('design-form').requestSubmit());
$('cancel').addEventListener('click', () => controller?.abort());
$('download').addEventListener('click', () => {
  if (!pdfUrl) return;
  const link = document.createElement('a'); link.href = pdfUrl; link.download = filename; link.click();
});
window.addEventListener('pagehide', () => { controller?.abort(); clearOutput(); });
window.addEventListener('pageshow', event => { if (event.persisted) generate(); });
generate();
