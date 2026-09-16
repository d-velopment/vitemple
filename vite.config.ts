import { defineConfig } from 'vite';
import { temple } from './dist/compiler.js';

export default defineConfig({
  root: 'examples/basic',
  plugins: [temple()],
  server: { open: '/demo.html' },
  build: { rollupOptions: { input: 'examples/basic/demo.html' } },
});
