<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { ref } from 'vue';
import DocumentEditor from './DocumentEditor.vue';

const open = ref(true);
</script>

<template>
  <header class="site-header">
    <a class="wordmark" href="https://www.fullbleed.dev/">fullbleed<span>.</span></a>
    <span class="header-note">VUE + TYPESCRIPT / MIT</span>
    <a class="docs-link" href="https://docs.fullbleed.dev/guides/browser-pdf/">Browser guide <span aria-hidden="true">↗</span></a>
  </header>
  <main>
    <div class="intro">
      <p class="eyebrow"><span />YOUR FORM → YOUR PDF</p>
      <h1>Your Vue form.<br />Your finished PDF.</h1>
      <p class="lede">Edit the details. Watch the actual PDF update.<br class="wide-only" /> A Vue starter with HTML/CSS templates and local rendering.</p>
    </div>
    <div class="workspace-switch">
      <span><span class="live-dot" />{{ open ? 'Document editor' : 'Editor closed' }}</span>
      <button id="toggle-editor" class="text-button" @click="open = !open">{{ open ? 'Close editor' : 'Open editor' }}</button>
    </div>
    <DocumentEditor v-if="open" />
    <section v-else class="closed-panel"><h2>Ready when you are.</h2><p>Open the editor to start a fresh document.</p></section>
    <footer>
      <p>Built with Fullbleed. MIT licensed, including commercial use.</p>
      <a href="https://github.com/fullbleed-engine/fullbleed-node/tree/main/examples/vue">Get the Vue source ↗</a>
    </footer>
  </main>
</template>
