import { apiError, requireEditor, verifyMutation, limitedBytes, json, AppError } from '@/lib/server';
import { InvalidImage, MAX_IMAGE_BYTES, normalizeImage } from '@/lib/image-format';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    verifyMutation(request);
    const editor = await requireEditor();
    const admin = createSupabaseAdminClient();
    const { data: allowed, error: rateError } = await admin.rpc('consume_rate_limit', {
      p_key: `upload:${editor.userId}`, p_limit: 30, p_window_seconds: 3600,
    });
    if (rateError) throw rateError;
    if (!allowed) throw new AppError('rate_limited', 429);
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const rawBytes = await limitedBytes(request, MAX_IMAGE_BYTES);
    let image;
    try {
      image = await normalizeImage(rawBytes, contentType);
    } catch (error) {
      if (error instanceof InvalidImage) {
        throw new AppError(error.message, error.message === 'too_large' ? 413 : 400);
      }
      throw error;
    }
    const key = `${crypto.randomUUID()}.${image.extension}`;
    const bucket = admin.storage.from('covers');
    const { error: uploadError } = await bucket.upload(key, image.bytes, {
      contentType: image.contentType, cacheControl: '0', upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await admin.from('media').insert({
      key, content_type: image.contentType, size: image.bytes.length,
      owner_id: editor.userId, width: image.width, height: image.height,
    });
    if (metadataError) {
      await bucket.remove([key]);
      throw metadataError;
    }
    return json({ url: `/media/${key}` }, 201);
  } catch (error) {
    return apiError(error);
  }
}
