/**
 * Configures the local Vite server to use the Vitemple compiler plugin and the example project entry page.
 */
import { defineConfig } from "vite";
import { temple } from "./dist/compiler.js";

export default defineConfig({
  root: "../vitemple-example/basic/src",
  plugins: [temple()],
  server: { open: "/demo.html" },
  build: {
    rollupOptions: { input: "../vitemple-example/basic/src/index.html" },
  },
});
