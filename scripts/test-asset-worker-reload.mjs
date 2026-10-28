import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";

async function until(predicate) {
  const end = Date.now() + 30000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Dependency optimization did not settle.");
    await new Promise(done => setTimeout(done, 50));
  }
}

test("first asset IFC worker import does not reload an already open viewer", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "nemy-worker-hmr-"));
  const server = await createServer({ cacheDir, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { holdUntilCrawlEnd: false } });
  try {
    const environment = server.environments.client;
    const optimizer = environment.depsOptimizer;
    assert.ok(optimizer);
    const reloads = [];
    environment.hot.send = payload => { if (payload?.type === "full-reload") reloads.push(payload); };
    await optimizer.init();
    await optimizer.scanProcessing;
    optimizer.run();
    await until(() => optimizer.metadata.optimized["@thatopen/fragments"]);
    // The viewer is now loaded. This lazy request is made when Assign Asset first starts IFC extraction.
    reloads.length = 0;
    await environment.transformRequest("/src/asset-ifc-worker.ts?worker_file&type=module");
    const dependency = optimizer.metadata.discovered["web-ifc"] ?? optimizer.metadata.optimized["web-ifc"];
    assert.ok(dependency);
    optimizer.run();
    await dependency.processing;
    await until(() => optimizer.metadata.optimized["web-ifc"]);
    await environment.waitForRequestsIdle();
    await new Promise(done => setImmediate(done));
    assert.equal(reloads.length, 0, "Loading the asset worker forced a full-page reload, losing scan and layer state.");
  } finally {
    await server.close();
    assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});
