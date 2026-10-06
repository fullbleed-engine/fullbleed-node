<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, reactive, ref } from 'vue';
import { usePdfPreview } from './usePdfPreview';
import invoiceHtml from './invoice.html?raw';
import invoiceCss from './invoice.css?raw';
import reportHtml from './report.html?raw';
import reportCss from './report.css?raw';

const defaults = { invoice: { html: invoiceHtml, css: invoiceCss }, report: { html: reportHtml, css: reportCss } };
const templates = reactive({ invoice: { ...defaults.invoice }, report: { ...defaults.report } });
const design = ref<keyof typeof defaults>('invoice');
const template = computed(() => templates[design.value]);
const customer = ref('Maple & Finch');
const reference = ref('NS-1042');
const ink = ref('#17382e');
const autoPreview = ref(true);
const accentInput = ref<HTMLInputElement>();
const assetBaseUrl = new URL('fullbleed/', new URL(import.meta.env.BASE_URL, location.href)).href;
const placeholders = { customer: '{{customer}}', reference: '{{reference}}', ink: '{{ink}}' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const inputError = computed(() => !template.value.html.trim() ? 'Enter document HTML before generating.'
  : design.value === 'invoice' && (!customer.value.trim() || !reference.value.trim()) ? 'Enter a customer name and invoice reference.'
  : design.value === 'invoice' && !/^#[\da-f]{6}$/i.test(ink.value) ? 'Enter a six-digit ink color, such as #17382e.' : '');
const input = computed(() => {
  const values: Record<string, string> = { customer: customer.value.trim(), reference: reference.value.trim() };
  return {
    html: inputError.value ? '' : template.value.html.replace(/{{(customer|reference)}}/g, (_, key: string) => escapeHtml(values[key])),
    css: template.value.css.replaceAll('{{ink}}', /^#[\da-f]{6}$/i.test(ink.value) ? ink.value : '#17382e'),
    previewDpi: 96, maxPages: 20, timeoutMs: 30_000,
  };
});
const { status, result, error, generate, cancel } = usePdfPreview(input, assetBaseUrl, { auto: autoPreview });
const pending = computed(() => status.value === 'queued' || status.value === 'rendering');
const filename = computed(() => design.value === 'invoice'
  ? `invoice-${reference.value.replace(/[^\w-]+/g, '-').slice(0, 32)}.pdf` : 'community-report.pdf');
const messages: Record<string, string> = {
  MISSING_GLYPHS: 'Some characters need another font. Add font bytes to the input or edit the text.',
  ENGINE_LOAD_FAILED: 'The PDF runtime could not load. Check that all runtime files were deployed.',
  VERSION_MISMATCH: 'The app and runtime versions differ. Rebuild and deploy the complete project.',
  TIMEOUT: 'This document took too long. Reduce its size or generate it again.',
};
const statusMessage = computed(() => {
  if (result.value) return `Ready. ${result.value.pages} ${result.value.pages === 1 ? 'page' : 'pages'} · ${Math.ceil(result.value.bytes / 1024)} KiB. Your PDF is ready to download.`;
  if (status.value === 'queued') return 'Preview updates after you pause typing.';
  if (status.value === 'rendering') return 'Rendering locally. The first preview also loads the engine and fonts.';
  if (status.value === 'cancelled') return 'Cancelled. Edit a field or choose Generate PDF to continue.';
  if (status.value === 'error') return inputError.value || messages[error.value!.code] || error.value!.message;
  return 'Generate a PDF when you are ready.';
});
const resetTemplate = () => { templates[design.value] = { ...defaults[design.value] }; };
</script>

<template>
  <div class="workspace">
    <section class="controls" aria-labelledby="controls-title">
      <div class="panel-heading"><span class="step">01</span><h2 id="controls-title">Change the details</h2></div>
      <label for="kind">Start with a design</label>
      <select id="kind" v-model="design"><option value="invoice">Studio invoice</option><option value="report">Community report · 3 pages</option></select>
      <template v-if="design === 'invoice'">
        <label for="customer">Customer name</label><input id="customer" v-model="customer" maxlength="100" />
        <label for="reference">Invoice reference</label><input id="reference" v-model="reference" maxlength="48" />
        <label for="accent">Ink color</label>
        <div class="color-row">
          <input id="accent" ref="accentInput" v-model="ink" type="color" maxlength="7" pattern="#[0-9a-fA-F]{6}"
            :class="{ 'color-text': accentInput && accentInput.type !== 'color' }" />
          <span>{{ ink.toUpperCase() }}</span><span class="color-hint">Your print palette</span>
        </div>
      </template>
      <p class="sample-note">{{ design === 'invoice' ? 'Fictional invoice. Items and amounts are fixed for this example.' : 'A three-page report. All organizations, records and amounts are fictional.' }}</p>
      <label class="auto-toggle"><input id="auto-preview" v-model="autoPreview" type="checkbox" />Update automatically</label>
      <div class="actions">
        <button id="generate" @click="generate">Generate PDF <span aria-hidden="true">→</span></button>
        <button v-if="pending" id="cancel" class="secondary" @click="cancel">Cancel</button>
      </div>
      <p id="status" role="status" aria-live="polite" :class="{ error: status === 'error' }">{{ statusMessage }}</p>
      <div class="local-note"><span class="local-dot" aria-hidden="true" /><p><strong>Local rendering. Your document.</strong><br />{{ autoPreview ? 'Changes render after a short pause.' : 'Choose Generate PDF to apply your changes.' }} Your document inputs stay in this browser.</p></div>
    </section>
    <section class="preview-panel" aria-labelledby="preview-title">
      <div class="preview-toolbar">
        <div><span class="step">02</span><h2 id="preview-title">The actual PDF</h2><span id="page-count">{{ result ? `${result.pages} ${result.pages === 1 ? 'page' : 'pages'}` : '' }}</span></div>
        <a v-if="result" id="download" class="button" :href="result.url" :download="filename">Download PDF <span aria-hidden="true">↓</span></a>
        <button v-else id="download" disabled>Download PDF <span aria-hidden="true">↓</span></button>
      </div>
      <div id="preview" class="preview-area" :aria-busy="pending">
        <template v-if="result"><img v-for="(url, index) in result.previews" :key="url" :src="url" :alt="`Rendered PDF, page ${index + 1} of ${result.pages}`" /></template>
        <div v-else class="placeholder"><div class="paper-icon" aria-hidden="true" /><p>{{ pending ? 'Making your document…' : 'Your next preview will appear here.' }}</p></div>
      </div>
    </section>
  </div>
  <details id="template-editor" class="template-editor">
    <summary>Edit the HTML &amp; CSS</summary>
    <p class="editor-note">Paste your own print template. {{ autoPreview ? 'Changes update the PDF automatically.' : 'Choose Generate PDF to apply your changes.' }} Invoice values use <code>{{ placeholders.customer }}</code>, <code>{{ placeholders.reference }}</code>, and <code>{{ placeholders.ink }}</code>. These edits last until reload.</p>
    <div class="editor-grid">
      <div><label for="html-source">Document HTML</label><textarea id="html-source" v-model="template.html" :spellcheck="false" /></div>
      <div><label for="css-source">Print CSS</label><textarea id="css-source" v-model="template.css" :spellcheck="false" /></div>
    </div>
    <div class="editor-actions"><button id="reset-source" class="secondary" @click="resetTemplate">Reset this template</button><p>Keep templates in the downloaded project's <code>src/</code> directory.</p></div>
  </details>
</template>
