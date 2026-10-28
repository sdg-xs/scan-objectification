/** Read a SAM mask in capture pixels, independent of HTML image density/layout. */
export async function decodeSelectionMask(png: string, frame: { width: number; height: number }): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new Error("SAM returned an invalid selection mask.");
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width !== frame.width || height !== frame.height)
    throw new Error(`The selection mask is ${width} × ${height} pixels; the capture is ${frame.width} × ${frame.height}. Capture & detect again.`);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    imageOrientation: "none", colorSpaceConversion: "none", premultiplyAlpha: "none",
  });
  try {
    if (bitmap.width !== width || bitmap.height !== height)
      throw new Error(`The browser decoded a ${bitmap.width} × ${bitmap.height} mask instead of ${width} × ${height}. Capture & detect again.`);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not read the selection mask.");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    for (let index = 0; index < pixels.length; index++)
      pixels[index] = Number(rgba[index * 4]! > 127 && rgba[index * 4 + 3]! > 127);
    return pixels;
  } finally { bitmap.close(); }
}
