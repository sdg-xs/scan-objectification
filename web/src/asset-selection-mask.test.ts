import { expect, it } from "vitest";
import { createSelectionTexture } from "./asset-selection";

it("allocates complete GPU texture layers for the 4.8 million splat scan", () => {
  const mask = createSelectionTexture(4_778_721);
  const texture = mask.getTexture();
  const { width, height, depth } = texture.image;
  expect(mask.count).toBe(4_778_721);
  expect(mask.array?.length).toBe(width * height * depth * 4);
  mask.dispose();
});
