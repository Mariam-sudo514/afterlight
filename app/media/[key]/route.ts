import { editorIdentity, apiError } from '@/lib/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { MAX_IMAGE_BYTES } from '@/lib/image-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function notFound() {
  return new Response(null, { status: 404, headers: privateHeaders });
}

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(key)) {
      return notFound();
    }
    const client = await createSupabaseServerClient();
    const { data: publicUse, error: permissionError } = await client.from('posts')
      .select('id').eq('cover', `/media/${key}`).eq('status', 'published').limit(1).maybeSingle();
    if (permissionError) throw permissionError;
    const editor = publicUse ? null : await editorIdentity();
    if (!publicUse && !editor) return notFound();

    // Service access is deliberately downstream of current publication/owner checks.
    // Never redirect to a signed URL: it would outlive an unpublication decision.
    const admin = createSupabaseAdminClient();
    const { data: media, error: metadataError } = await admin.from('media')
      .select('content_type,size,owner_id').eq('key', key).maybeSingle();
    if (metadataError) throw metadataError;
    if (!media || (!publicUse && media.owner_id !== editor?.userId)) return notFound();
    const { data, error: downloadError } = await admin.storage.from('covers').download(key);
    if (downloadError || !data || data.size > MAX_IMAGE_BYTES || data.size !== media.size) return notFound();
    return new Response(data, {
      headers: { ...privateHeaders, 'Content-Type': media.content_type },
    });
  } catch (error) {
    return apiError(error);
  }
}
