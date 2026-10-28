import { open, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const marker = "comment nemy_aligned_z_up 1";

async function readExact(file, buffer, position) {
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await file.read(
      buffer,
      filled,
      buffer.length - filled,
      position + filled,
    );
    if (!bytesRead) throw new Error("The PLY data is truncated.");
    filled += bytesRead;
  }
}

async function layout(file) {
  const { size } = await file.stat();
  const prefix = Buffer.alloc(Math.min(size, 65536));
  await readExact(file, prefix, 0);
  const match = /\r?\nend_header\r?\n/.exec(prefix.toString("latin1"));
  if (!match) throw new Error("PLY header is absent or exceeds 64 KiB.");
  const offset = match.index + match[0].length;
  const lines = prefix
    .subarray(0, offset)
    .toString("ascii")
    .trimEnd()
    .split(/\r?\n/);
  if (lines[0] !== "ply" || lines[1] !== "format binary_little_endian 1.0") {
    throw new Error(
      "This tool requires standard binary little-endian Gaussian PLY.",
    );
  }
  const elements = lines.filter((line) => line.startsWith("element "));
  if (elements.length !== 1 || !/^element vertex \d+$/.test(elements[0])) {
    throw new Error("This tool requires a single vertex element.");
  }
  const count = Number(elements[0].split(" ")[2]);
  const properties = lines.filter((line) => line.startsWith("property "));
  if (
    !properties.every((line) => /^property (float|float32) \w+$/.test(line))
  ) {
    throw new Error("This tool requires scalar float32 vertex properties.");
  }
  const names = properties.map((line) => line.split(" ")[2]);
  const xyz = ["x", "y", "z"].map((name) => names.indexOf(name) * 4);
  const stride = properties.length * 4;
  if (
    xyz.some((value) => value < 0) ||
    new Set(names).size !== names.length ||
    !count ||
    offset + count * stride !== size
  ) {
    throw new Error("The PLY layout or vertex data is invalid.");
  }
  return { lines, offset, count, stride, xyz };
}

async function* chunks(file, description) {
  const batch = 16384;
  const buffer = Buffer.alloc(batch * description.stride);
  for (let first = 0; first < description.count; first += batch) {
    const chunk = buffer.subarray(
      0,
      Math.min(batch, description.count - first) * description.stride,
    );
    await readExact(
      file,
      chunk,
      description.offset + first * description.stride,
    );
    yield chunk;
  }
}

// Current alignment is translation-only, so all other Gaussian attributes stay byte-identical.
export async function saveTranslatedPly(sourcePath, outputPath, translation) {
  const shift = [translation.x, translation.y, translation.z];
  if (!shift.every(Number.isFinite))
    throw new Error("Translation must contain finite x, y and z values.");
  const source = await open(sourcePath, "r");
  let output;
  try {
    const description = await layout(source);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for await (const chunk of chunks(source, description)) {
      for (let start = 0; start < chunk.length; start += description.stride) {
        for (let axis = 0; axis < 3; axis++) {
          const value = chunk.readFloatLE(start + description.xyz[axis]);
          if (!Number.isFinite(value))
            throw new Error("The PLY has non-finite positions.");
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    }
    const centered = !description.lines.includes(marker);
    const delta = shift.map(
      (value, axis) => value - (centered ? (min[axis] + max[axis]) / 2 : 0),
    );
    const lines = description.lines.filter(
      (line) =>
        line !== "end_header" &&
        line !== marker &&
        !/^comment (offset[xyz]|epsg|nemy_alignment)\b/i.test(line),
    );
    lines.splice(
      2,
      0,
      marker,
      `comment nemy_alignment translation ${shift.join(" ")} viewer_local_z_up`,
    );
    output = await open(outputPath, "wx");
    await output.writeFile(lines.join("\n") + "\nend_header\n");
    for await (const chunk of chunks(source, description)) {
      for (let start = 0; start < chunk.length; start += description.stride) {
        for (let axis = 0; axis < 3; axis++) {
          const offset = start + description.xyz[axis];
          const value = Math.fround(chunk.readFloatLE(offset) + delta[axis]);
          if (!Number.isFinite(value))
            throw new Error("The transformed position exceeds float32 range.");
          chunk.writeFloatLE(value, offset);
        }
      }
      await output.writeFile(chunk);
    }
    await output.sync();
    return {
      vertices: description.count,
      translation,
      center: min.map((value, axis) => (value + max[axis]) / 2),
    };
  } catch (error) {
    if (output) {
      await output.close();
      output = undefined;
      await unlink(outputPath);
    }
    throw error;
  } finally {
    await output?.close();
    await source.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [source, output, x, y, z] = process.argv.slice(2);
  if (!source || !output || z === undefined) {
    throw new Error(
      "Usage: node scripts/save-aligned-ply.mjs source.ply aligned.ply x y z",
    );
  }
  console.log(
    JSON.stringify(
      await saveTranslatedPly(source, output, {
        x: Number(x),
        y: Number(y),
        z: Number(z),
      }),
    ),
  );
}
