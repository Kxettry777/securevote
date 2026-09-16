const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { normalizeBanner } = require("../media/banner");

test("banner processing rejects invalid payloads and stores resized images without metadata", async () => {
  const source = await sharp({ create: { width: 2200, height: 800, channels: 3, background: "#234c73" } }).jpeg().withMetadata().toBuffer();
  const stored = await normalizeBanner(source, "image/jpeg");
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.exif, undefined);
  for (const [bytes, type, status] of [
    [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>"), "image/png", 400],
    [Buffer.from("not a real image"), "image/png", 400],
    [source, "image/png", 400],
    [source, "image/svg+xml", 415],
    [Buffer.alloc(0), "image/png", 400],
    [Buffer.alloc(4 * 1024 * 1024 + 1), "image/png", 413],
  ]) await assert.rejects(normalizeBanner(bytes, type), { status });
  const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeBanner(oversized, "image/png"), { status: 400 });
});
