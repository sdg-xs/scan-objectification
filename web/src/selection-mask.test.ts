import { afterEach, expect, it, vi } from "vitest";
import { decodeSelectionMask } from "./selection-mask";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAAAAADRSSBWAAAAC0lEQVR4nGP4zwAAAgEBADK6K5IAAAAASUVORK5CYII=";
afterEach(() => vi.unstubAllGlobals());

it("rejects a real mask/capture mismatch before decoding", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  await expect(decodeSelectionMask(png, { width: 1, height: 1 })).rejects.toThrow("mask is 2 × 1 pixels; the capture is 1 × 1");
  expect(decode).not.toHaveBeenCalled();
});

it("releases bitmap resources when the browser cannot provide a pixel canvas", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close })));
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  await expect(decodeSelectionMask(png, { width: 2, height: 1 })).rejects.toThrow("could not read");
  expect(close).toHaveBeenCalledOnce();
});

it("rejects unexpected decoded dimensions rather than stretching a mask", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close })));
  await expect(decodeSelectionMask(png, { width: 2, height: 1 })).rejects.toThrow("decoded a 1 × 1 mask instead of 2 × 1");
  expect(close).toHaveBeenCalledOnce();
});
