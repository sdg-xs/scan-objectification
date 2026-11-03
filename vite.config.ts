import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

function checkBackendReady(): Promise<boolean> {
  return new Promise((resolveReady) => {
    const req = http.get("http://127.0.0.1:8767/api/health", { timeout: 1000 }, (res) => {
      resolveReady(res.statusCode === 200);
    });
    req.on("error", () => resolveReady(false));
    req.on("timeout", () => {
      req.destroy();
      resolveReady(false);
    });
  });
}

function autoBackendPlugin(): Plugin {
  let backendProcess: ChildProcess | null = null;

  return {
    name: "auto-backend",
    apply: "serve",
    async configureServer(server) {
      if (server.config.server.middlewareMode) {
        return;
      }

      const isAlreadyRunning = await checkBackendReady();
      if (isAlreadyRunning) {
        server.config.logger.info("  ➜  Backend:   http://127.0.0.1:8767/ (running)");
        return;
      }

      const projectRoot = fileURLToPath(new URL(".", import.meta.url));
      const python =
        process.platform === "win32"
          ? resolve(projectRoot, ".venv/Scripts/python.exe")
          : resolve(projectRoot, ".venv/bin/python");

      if (!existsSync(python)) {
        server.config.logger.warn(
          `[backend] Python virtual environment not found at ${python}. Start backend manually.`
        );
        return;
      }

      server.config.logger.info("  ➜  Backend:   starting FastAPI on http://127.0.0.1:8767/…");

      const child = spawn(python, ["-m", "nemy_web.app"], {
        cwd: projectRoot,
        stdio: "inherit",
      });
      backendProcess = child;

      child.on("error", (err) => {
        server.config.logger.error(`[backend] Error starting backend: ${err.message}`);
      });

      child.on("exit", () => {
        if (backendProcess === child) {
          backendProcess = null;
        }
      });

      const start = Date.now();
      while (Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 100));
        if (await checkBackendReady()) {
          server.config.logger.info("  ➜  Backend:   http://127.0.0.1:8767/ (ready)");
          break;
        }
      }

      const cleanup = (): void => {
        if (backendProcess && !backendProcess.killed) {
          try {
            backendProcess.kill();
          } catch {
            // Already exited
          }
          backendProcess = null;
        }
      };

      server.httpServer?.on("close", cleanup);
      process.once("exit", cleanup);
    },
  };
}

/**
 * The frontend lives in `web/` and is built to the repository-root `dist/`
 * directory, which is the directory the FastAPI app serves when it exists.
 * During development Vite proxies `/api` to the API on port 8767 so the
 * browser still talks to a single same-origin API.
 */
export default defineConfig({
  root: "web",
  plugins: [autoBackendPlugin()],
  // The asset IFC worker starts on demand. Discovering this dependency later
  // changes Fragments' shared prebundle and reloads the session-only viewer.
  optimizeDeps: { include: ["web-ifc", "react", "react-dom/client", "react/jsx-runtime"] },
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
