import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist-server",
    ssr: "src/server/production.ts",
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "production.js",
      },
    },
  },
});
