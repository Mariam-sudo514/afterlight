import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  InvalidImage,
  MAX_IMAGE_BYTES,
  normalizeImage,
} from "../lib/image-format";

const sample = () =>
  sharp({
    create: { width: 20, height: 12, channels: 3, background: "#ad2631" },
  });
const invalid = (error: unknown) =>
  error instanceof InvalidImage && error.message === "image_type";

test("valid JPEG, PNG and WebP fully decode and normalize to bounded WebP", async () => {
  for (const [format, type] of [
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const) {
    const input = await sample().toFormat(format).toBuffer();
    const output = await normalizeImage(input, type);
    const decoded = await sharp(output.bytes).metadata();
    assert.equal(output.contentType, "image/webp");
    assert.equal(decoded.format, "webp");
    assert.equal(output.width, 20);
    assert.equal(output.height, 12);
    assert.ok(output.bytes.length <= MAX_IMAGE_BYTES);
  }
});

test("normalization applies EXIF orientation and removes metadata", async () => {
  const input = await sample()
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const output = await normalizeImage(input, "image/jpeg");
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(metadata.width, 12);
  assert.equal(metadata.height, 20);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("MIME spoofing, SVG, malformed headers and truncated image data are rejected", async () => {
  const png = await sample().png().toBuffer();
  const jpeg = await sample().jpeg().toBuffer();
  await assert.rejects(normalizeImage(png, "image/jpeg"), invalid);
  await assert.rejects(
    normalizeImage(png, "application/octet-stream"),
    invalid,
  );
  await assert.rejects(
    normalizeImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      ),
      "image/png",
    ),
    invalid,
  );
  await assert.rejects(
    normalizeImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
    invalid,
  );
  await assert.rejects(
    normalizeImage(jpeg.subarray(0, jpeg.length - 12), "image/jpeg"),
    invalid,
  );
});

test("input byte and dimension limits are enforced before accepting a cover", async () => {
  await assert.rejects(
    normalizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"),
    invalid,
  );
  const wide = await sharp({
    create: { width: 16001, height: 1, channels: 3, background: "#111" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizeImage(wide, "image/png"), invalid);
  const large = await sharp({
    create: { width: 4500, height: 100, channels: 3, background: "#111" },
  })
    .png()
    .toBuffer();
  const output = await normalizeImage(large, "image/png");
  assert.equal(output.width, 4096);
  assert.ok(output.height > 0 && output.height < 100);
});
