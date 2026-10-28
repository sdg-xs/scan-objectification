import { createSHA256 } from "hash-wasm";

/** A bounded slice is the only file data resident in the hashing worker. */
export async function hashFile(file: Blob, progress: (bytes: number) => void): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    const slice = file.slice(offset, offset + 1024 * 1024);
    hash.update(new Uint8Array(await slice.arrayBuffer()));
    progress(Math.min(file.size, offset + slice.size));
  }
  return hash.digest("hex");
}

if (typeof self !== "undefined" && typeof document === "undefined") {
  self.onmessage = async ({data}: MessageEvent<File>) => {
    try {
      const digest = await hashFile(data, bytes => self.postMessage({bytes}));
      self.postMessage({digest});
    } catch {
      self.postMessage({error: "The file could not be hashed. Reselect it and retry."});
    }
  };
}
