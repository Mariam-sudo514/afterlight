import {
  apiError, requireEditor, verifyMutation, limitedBytes, savePost,
  listPostsPage, parsePage, json, AppError,
} from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireEditor();
    const page = parsePage(new URL(request.url).searchParams.get('page'));
    return json(await listPostsPage(true, page));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    verifyMutation(request);
    await requireEditor();
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      throw new AppError('invalid_content');
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 3 * 1024 * 1024)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('invalid_content');
    }
    return json({ post: await savePost(body) });
  } catch (error) {
    return apiError(error);
  }
}
