import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

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
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./web/index.html", import.meta.url)),
        viewer: fileURLToPath(new URL("./web/viewer.html", import.meta.url)),
      },
      output: {
        // web-ifc locates this binary by its fixed filename beside the WASM path.
        assetFileNames: (asset) =>
          asset.names.includes("web-ifc.wasm")
            ? "assets/[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
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
