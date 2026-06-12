import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  publicDir: false,
  build: {
    outDir: "roku-dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: "roku.html"
    }
  }
});
