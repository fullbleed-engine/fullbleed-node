// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['fullbleed'],
  outputFileTracingRoot: root,
  turbopack: { root },
  outputFileTracingIncludes: {
    '/api/invoices/*': [
      './templates/**/*',
      './node_modules/fullbleed/**/*',
      './node_modules/@bjorn3/browser_wasi_shim/**/*',
    ],
  },
};
