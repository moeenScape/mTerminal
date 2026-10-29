import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { contentSecurityPolicy } from './src/main/security.js';

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: 'renderer-content-security-policy',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, context) =>
            html.replace('__CSP__', contentSecurityPolicy(Boolean(context.server))),
        },
      },
    ],
    // Keep fonts as files: the Content-Security-Policy blocks data: fonts.
    build: { assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
