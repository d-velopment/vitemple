import { defineConfig } from 'vite';
import { temple } from './dist/compiler.js';

export default defineConfig({
  root: '../temple-example/basic/src',
  plugins: [temple()],
  server: { open: '/demo.html' },
  build: { rollupOptions: { input: '../temple-example/basic/src/index.html' } },
});
