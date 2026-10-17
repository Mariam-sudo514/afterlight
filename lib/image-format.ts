import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MIME_FORMATS: Record<string, string> = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
};

export class InvalidImage extends Error {}

/** Decode all image pixels, orient, bound dimensions and re-encode without EXIF. */
export async function normalizeImage(bytes: Uint8Array, contentType: string): Promise<{
  bytes: Buffer; contentType: 'image/webp'; extension: 'webp'; width: number; height: number;
}> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !MIME_FORMATS[contentType]) {
    throw new InvalidImage('image_type');
  }
  try {
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await decoder.metadata();
    if (metadata.format !== MIME_FORMATS[contentType] || !metadata.width || !metadata.height
      || metadata.width > 16000 || metadata.height > 16000
      || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1) {
      throw new InvalidImage('image_type');
    }
    // Sharp drops metadata by default. toBuffer performs a complete decode;
    // signatures and metadata alone do not establish a valid image.
    const result = await decoder.rotate()
      .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_IMAGE_BYTES) throw new InvalidImage('too_large');
    return {
      bytes: result.data, contentType: 'image/webp', extension: 'webp',
      width: result.info.width, height: result.info.height,
    };
  } catch (error) {
    if (error instanceof InvalidImage) throw error;
    throw new InvalidImage('image_type');
  }
}
