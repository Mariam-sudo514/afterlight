import 'server-only';

import { requireEditor } from './auth';
import { AppError } from './http';
import { postSchema, readyToPublish, type Post, type PostSummary, POSTS_PAGE_SIZE } from './content';
import { createSupabaseServerClient } from './supabase/server';

export { editorIdentity, requireEditor } from './auth';
export { AppError, apiError, json, limitedBytes, verifyMutation } from './http';

type PostRow = {
  id: string;
  slug: string;
  category: Post['category'];
  status: Post['status'];
  cover: string;
  cover_kind: Post['coverKind'];
  ru: Post['ru'];
  en: Post['en'];
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type SummaryRow = Omit<PostRow, 'ru' | 'en'> & {
  ru: PostSummary['ru'];
  en: PostSummary['en'];
  ru_reading_minutes: number;
  en_reading_minutes: number;
};

function fromRow(row: PostRow): Post {
  return {
    id: row.id, slug: row.slug, category: row.category, status: row.status,
    cover: row.cover, coverKind: row.cover_kind, ru: row.ru, en: row.en,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function fromSummaryRow(row: SummaryRow): PostSummary {
  return {
    id: row.id, slug: row.slug, category: row.category, status: row.status,
    cover: row.cover, coverKind: row.cover_kind, ru: row.ru, en: row.en,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    publishedAt: row.published_at,
    readingMinutes: { ru: row.ru_reading_minutes, en: row.en_reading_minutes },
  };
}

export function parsePage(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  return Math.max(1, Math.min(100000, Number(value)));
}

export async function listPostsPage(admin = false, page = 1): Promise<{
  posts: PostSummary[]; page: number; hasMore: boolean;
}> {
  if (admin) await requireEditor();
  const client = await createSupabaseServerClient();
  const currentPage = parsePage(String(page));
  const start = (currentPage - 1) * POSTS_PAGE_SIZE;
  // The security-invoker view preserves posts RLS and never returns article bodies.
  let query = client.from('post_summaries').select('*');
  if (!admin) query = query.eq('status', 'published');
  const { data, error } = await query
    .order(admin ? 'updated_at' : 'published_at', { ascending: false })
    .order('id', { ascending: true }).range(start, start + POSTS_PAGE_SIZE);
  if (error) throw error;
  const rows = data as SummaryRow[];
  return {
    posts: rows.slice(0, POSTS_PAGE_SIZE).map(fromSummaryRow),
    page: currentPage, hasMore: rows.length > POSTS_PAGE_SIZE,
  };
}

export async function listPosts(admin = false, page = 1): Promise<PostSummary[]> {
  return (await listPostsPage(admin, page)).posts;
}

export async function publishedPost(slug: string): Promise<Post | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from('posts').select('*')
    .eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as PostRow) : null;
}

export async function getEditorPost(id: string): Promise<Post | null> {
  await requireEditor();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from('posts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as PostRow) : null;
}

export async function savePost(input: unknown): Promise<Post> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_content');
  if (parsed.data.status === 'published' && !readyToPublish(parsed.data)) {
    throw new AppError('translation_required');
  }
  const client = await createSupabaseServerClient();
  // The RPC verifies auth.uid(), validates content and commits exactly one version.
  // It uses the session's JWT, never a service-role client.
  const { data, error } = await client.rpc('save_post', { p_post: parsed.data });
  if (error) {
    const known: Record<string, number> = {
      forbidden: 403, stale: 409, slug_exists: 409, slug_locked: 400,
      cover_missing: 400, translation_required: 400, invalid_content: 400,
    };
    if (error.message in known) throw new AppError(error.message, known[error.message]);
    throw error;
  }
  return fromRow(data as PostRow);
}
