import { expect, it } from "vitest";
import { hashFile } from "./hash-worker";

it("hashes bounded slices incrementally and reports progress", async () => {
  const file = new Blob(["abc"]);
  const progress: number[] = [];
  const original = file.slice.bind(file);
  file.slice = (start, end) => {
    expect((end ?? file.size) - (start ?? 0)).toBeLessThanOrEqual(1024 * 1024);
    return original(start, end);
  };
  expect(await hashFile(file, n => progress.push(n))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(progress.at(-1)).toBe(3);
});
