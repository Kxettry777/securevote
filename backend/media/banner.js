const sharp = require("sharp");
const { ElectionError } = require("../models/Election");
const types = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

async function normalizeBanner(buffer, contentType) {
  if (!types[contentType]) throw new ElectionError(415, "Choose a JPEG, PNG, or WebP image");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ElectionError(400, "Choose an image to upload");
  if (buffer.length > 4 * 1024 * 1024) throw new ElectionError(413, "Banner images must be 4 MB or smaller");
  try {
    const image = sharp(buffer, { limitInputPixels: 16000000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== types[contentType] || (metadata.pages || 1) !== 1) throw new Error("Unsupported image");
    // Decode and re-encode instead of serving untrusted original bytes/metadata.
    return await image.rotate().resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new ElectionError(400, "Use a valid, non-animated JPEG, PNG, or WebP image with at most 16 million pixels");
  }
}
module.exports = { normalizeBanner };
