import { defineConfig } from "vite";

/**
 * The frontend lives in `web/` and is built to the repository-root `dist/`
 * directory, which is the directory the FastAPI app serves when it exists.
 * During development Vite proxies `/api` to the API on port 8767 so the
 * browser still talks to a single same-origin API.
 */
export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8767",
        changeOrigin: true,
      },
    },
  },
});
