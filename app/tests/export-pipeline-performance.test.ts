import { expect, it } from "vitest";
import sharp from "sharp";
import { encodeExportImage, encodePreparedExportImage, prepareExportImage } from "../server/export-image-pipeline";
import { DEFAULT_WEBP } from "../shared/export-preparation";

// This matrix performs 32 real encodes. Allow slower recipient Macs to
// complete byte-parity checks; this does not set an application timeout.
it("skips the PNG intermediary without changing orientation, alpha, colors or encoded output", async () => {
  const width = 380, height = 270;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = (x * 13 + y * 17) % 256;
    pixels[i + 1] = (x * 3 + y * 23) % 256;
    pixels[i + 2] = (x * x + y * 3) % 256;
    pixels[i + 3] = (x * 7 + y * 11) % 256;
  }
  const image = () => sharp(pixels, { raw: { width, height, channels: 4 } });
  const sources = [
    await image().png().toBuffer(),
    await image().flatten().withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    await image().webp().toBuffer(),
    await image().flatten().toColourspace("b-w").png().toBuffer(),
  ];
  for (const source of sources) for (const format of ["webp", "png"] as const) for (const lossless of [false, true]) {
    const settings = { ...DEFAULT_WEBP, maximumDimension: 128, lossless };
    const expected = await encodePreparedExportImage(await prepareExportImage(source), settings, format);
    const actual = await encodeExportImage(source, settings, undefined, format);
    expect(actual.info).toEqual(expected.info);
    expect(actual.data).toEqual(expected.data);
  }
}, 60_000);
