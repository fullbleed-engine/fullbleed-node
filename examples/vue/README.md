# Fullbleed Vue PDF starter

A Vue 3 and TypeScript application with editable HTML/CSS templates, automatic
PDF previews, cancellation, and downloads. Includes a designed invoice and a
three-page report with fictional sample data. MIT licensed.

## Run

Use Node.js 22.12 or newer for development and builds:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Change the customer or template and
wait for **Ready**, then choose **Download PDF**. Turn off **Update automatically**
to generate only on demand. Edits last until reload or closing the editor.

The browser loads the engine and fonts from the same static host, then renders
in a Web Worker. Document inputs are not uploaded to a PDF service.

## Connect your data and templates

`src/DocumentEditor.vue` contains the form, template state, and preview UI.
`src/App.vue` mounts it with `v-if`; closing the editor demonstrates cleanup.

The invoice fills `{{customer}}` and `{{reference}}` in HTML and `{{ink}}` in CSS.
Customer text is escaped, and the ink color must be a six-digit hex value.
Replace the fixed line items, totals, addresses, and dates with your data and
calculations for a real application.

Use **Edit the HTML & CSS** to try layouts. Keep changes in `src/invoice.html`,
`src/invoice.css`, `src/report.html`, and `src/report.css`. These are static print
templates consumed by Fullbleed, separate from Vue's component templates.
Use [supported print CSS](https://docs.fullbleed.dev/css-coverage/).

## Reuse the composable

Copy `src/usePdfPreview.ts` into your client application, install
`fullbleed@0.3.2`, and copy the runtime with
`npx fullbleed-browser-assets public/fullbleed`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { usePdfPreview } from './usePdfPreview';

const props = defineProps<{ html: string; css: string }>();
const input = computed(() => ({
  html: props.html, css: props.css,
  previewDpi: 96, maxPages: 20, timeoutMs: 30_000,
}));
const { status, result, error, generate, cancel } = usePdfPreview(input, '/fullbleed/');
</script>

<template>
  <section>
    <button @click="generate">Generate PDF</button>
    <button @click="cancel">Cancel</button>
    <p role="status">{{ error?.message ?? status }}</p>
    <template v-if="result">
      <a :href="result.url" download="document.pdf">Download PDF</a>
      <img v-for="(url, index) in result.previews" :key="url"
        :src="url" :alt="`PDF page ${index + 1}`" />
    </template>
  </section>
</template>
```

Call the composable during component setup. Pass a computed input or getter
that reads reactive values. For a ref containing an input object, replace the
object when changing it; this composable does not deeply watch fonts or assets.
It returns refs, so they can be destructured without losing reactivity.

The default delay is 450 ms. Set `{ auto: false }` to generate only on demand,
or pass a boolean ref as `auto` to change modes. `{ delayMs: 800 }` waits longer
after edits. Cancel stops the timer or active job until the next input change
or `generate()` call. Changing preview mode also resets output.

The watcher synchronously invalidates old downloads, aborts superseded work,
and ignores obsolete results. Replacing a preview or unmounting the component
revokes its PDF/PNG Blob URLs. Rendering starts after mount, and scope disposal
stops the watcher and releases its resources. See Vue's guidance on
[composable cleanup](https://vuejs.org/guide/reusability/composables.html).
Use this in a browser component; server rendering and `KeepAlive` deactivation
are not handled by this example.

Each instance owns one active worker handle. Bound concurrent instances for
your target devices. Browser termination has no native thread-exit promise.
The [browser SDK guide](https://github.com/fullbleed-engine/fullbleed-node/blob/main/docs/browser.md)
covers custom font/image bytes, limits, hosting policy, and structured errors.

## Build and deploy

```sh
npm run build
npm run preview
```

Deploy the complete `dist/` directory to a static HTTPS host. Relative paths
support nested deployment URLs. The asset-copy step verifies the installed
client, worker, engine, fonts, build manifest, and notices; deploy them together.
The deployed site needs no Node server. HTTPS or localhost, Web Workers,
WebAssembly, and Web Crypto are required.

## Versions and verification

The lockfile pins Fullbleed 0.3.2 / engine 2.5.11, Vue 3.5.43, TypeScript 6.0.3,
and Vite 8.3.2. TypeScript 6 is used because the pinned `vue-tsc` still needs
TypeScript's JavaScript compiler entry; TypeScript 7 does not expose it.

The repository's `Vue starter` workflow type-checks and builds the locked
project, then checks real PDF downloads in Chrome, Firefox, and Playwright
WebKit. An independent reader checks text and page sizes; default invoice and
report bytes are compared with the installed Node package. Checks exercise
input races, both preview modes, cancellation, recovery, template edits,
unmount/remount, Blob URL cleanup, and mobile layout. Worker counts observe
API handles. WebKit testing is not branded Safari certification.

This browser entry provides ordinary PDFs and previews. It does not expose
PDF/A, PDF/UA, PDF/X, or VDP options.
