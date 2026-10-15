import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  // Print components use Fullbleed's JSX runtime. Let their updates propagate to
  // the React form instead of treating them as React Fast Refresh boundaries.
  plugins: [react({ exclude: [/node_modules/, /[\\/]src[\\/]documents[\\/]/] })],
  build: { assetsInlineLimit: 0 },
});
