import { apiError, getEditorPost, json, requireEditor } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await context.params;
    const post = await getEditorPost(id);
    return post ? json({ post }) : json({ error: 'not_found' }, 404);
  } catch (error) {
    return apiError(error);
  }
}
