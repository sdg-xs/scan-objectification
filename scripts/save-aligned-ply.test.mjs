import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTranslatedPly } from "./save-aligned-ply.mjs";

test("saves centered viewer translation in PLY positions and preserves Gaussian attributes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemy-ply-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.ply");
  const output = join(directory, "aligned.ply");
  const header =
    "ply\nformat binary_little_endian 1.0\ncomment epsg 32632\ncomment offsetx 100\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n";
  const data = Buffer.alloc(32);
  [10, 20, 30, 0.7, 14, 26, 38, 0.9].forEach((value, index) =>
    data.writeFloatLE(value, index * 4),
  );
  const original = Buffer.concat([Buffer.from(header), data]);
  await writeFile(source, original);
  await saveTranslatedPly(source, output, { x: 17, y: 5.9, z: -3 });
  const saved = await readFile(output);
  const offset = saved.indexOf("end_header\n") + "end_header\n".length;
  assert.match(
    saved.subarray(0, offset).toString(),
    /comment nemy_aligned_z_up 1\n/,
  );
  assert.doesNotMatch(
    saved.subarray(0, offset).toString(),
    /comment (epsg|offsetx)/,
  );
  assert.equal(saved.readFloatLE(offset), 15);
  assert.ok(Math.abs(saved.readFloatLE(offset + 4) - 2.9) < 1e-5);
  assert.equal(saved.readFloatLE(offset + 8), -7);
  assert.equal(saved.readFloatLE(offset + 16), 19);
  assert.deepEqual(
    saved.subarray(offset + 12, offset + 16),
    data.subarray(12, 16),
  );
  assert.deepEqual(await readFile(source), original);
  await assert.rejects(
    saveTranslatedPly(source, output, { x: 0, y: 0, z: 0 }),
    /EEXIST/,
  );
});

test("does not recenter an aligned file when saving another translation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemy-ply-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "already-aligned.ply");
  const output = join(directory, "moved.ply");
  const header =
    "ply\nformat binary_little_endian 1.0\ncomment nemy_aligned_z_up 1\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n";
  const data = Buffer.alloc(12);
  [17, 5.9, -3].forEach((value, i) => data.writeFloatLE(value, i * 4));
  await writeFile(source, Buffer.concat([Buffer.from(header), data]));
  await saveTranslatedPly(source, output, { x: 2, y: 0, z: 0 });
  const saved = await readFile(output);
  assert.equal(saved.readFloatLE(saved.length - 12), 19);
  assert.equal(saved.readFloatLE(saved.length - 4), -3);
});
