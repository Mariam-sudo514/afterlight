-- Independent AFTERLIGHT PostgreSQL schema. No content is created on page reads.
-- Supabase manages auth/storage schemas; only app policies and the private bucket
-- are added here. Existing databases/volumes must never be reset for this migration.
create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);
alter table public.app_owner enable row level security;
revoke all on public.app_owner from public, anon, authenticated;
grant all on public.app_owner to service_role;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_owner o
    join auth.users u on u.id = o.user_id
    join auth.sessions s on s.user_id = u.id
    where o.singleton and o.user_id = auth.uid()
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= now())
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to anon, authenticated, service_role;

create function public.valid_translation(t jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(t) = 'object'
    and jsonb_typeof(t->'title') = 'string' and length(t->>'title') <= 160
    and jsonb_typeof(t->'excerpt') = 'string' and length(t->>'excerpt') <= 500
    and jsonb_typeof(t->'body') = 'string' and length(t->>'body') <= 180000
    and jsonb_typeof(t->'coverCaption') = 'string' and length(t->>'coverCaption') <= 300
    and t - array['title','excerpt','body','coverCaption'] = '{}'::jsonb,
    false
  );
$$;

create function public.complete_translation(t jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select public.valid_translation(t)
    and length(btrim(t->>'title')) >= 3
    and length(btrim(t->>'excerpt')) >= 10
    and length(btrim(t->>'body')) >= 30
    and length(btrim(t->>'coverCaption')) >= 3;
$$;

create function public.reading_minutes(body text) returns integer
language sql immutable set search_path = ''
as $$
  select greatest(1, ceil(cardinality(regexp_split_to_array(btrim(body), '\s+')) / 180.0)::integer);
$$;

create table public.posts (
  id text primary key check (length(id) between 1 and 80 and id ~ '^[a-z0-9-]+$'),
  slug text not null unique check (length(slug) between 3 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category text not null check (category in ('cults','analysis','unsolved','investigations')),
  status text not null check (status in ('draft','published')),
  cover text not null check (
    cover = '' or cover ~ '^/assets/(house|archive|forest)\.webp$'
    or cover ~ '^/media/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$'
  ),
  cover_kind text not null check (cover_kind in ('illustration','photo','document')),
  ru jsonb not null check (public.valid_translation(ru)),
  en jsonb not null check (public.valid_translation(en)),
  version integer not null default 1 check (version between 1 and 2147483647),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  ru_reading_minutes integer generated always as (public.reading_minutes(ru->>'body')) stored,
  en_reading_minutes integer generated always as (public.reading_minutes(en->>'body')) stored,
  constraint published_content_complete check (
    status <> 'published' or (
      cover <> '' and published_at is not null
      and public.complete_translation(ru) and public.complete_translation(en)
    )
  )
);
create index posts_published_order on public.posts (published_at desc, id) where status = 'published';
create index posts_editor_order on public.posts (updated_at desc, id);
create index posts_published_cover on public.posts (cover) where status = 'published';
alter table public.posts enable row level security;
revoke all on public.posts from public, anon, authenticated;
grant select on public.posts to anon, authenticated;
grant all on public.posts to service_role;
create policy posts_read on public.posts for select to anon, authenticated
  using (status = 'published' or (select public.is_owner()));
-- No client table-write grants or policies. All owner saves use the atomic RPC.

create view public.post_summaries with (security_invoker = true) as
select id, slug, category, status, cover, cover_kind, version,
  created_at, updated_at, published_at, ru_reading_minutes, en_reading_minutes,
  ru - 'body' as ru, en - 'body' as en
from public.posts;
revoke all on public.post_summaries from public, anon, authenticated;
grant select on public.post_summaries to anon, authenticated, service_role;

create table public.media (
  key text primary key check (key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  size integer not null check (size between 1 and 4194304),
  owner_id uuid not null references auth.users(id) on delete restrict,
  width integer not null check (width between 1 and 16000),
  height integer not null check (height between 1 and 16000),
  created_at timestamptz not null default now(),
  check (width::bigint * height <= 40000000)
);
alter table public.media enable row level security;
revoke all on public.media from public, anon, authenticated;
grant select on public.media to authenticated;
grant all on public.media to service_role;
create policy media_owner_read on public.media for select to authenticated
  using ((select public.is_owner()) and owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- No permissive storage.objects policies for browser roles. In particular, SELECT would
-- permit durable signed URLs that survive unpublication. The app rechecks access
-- on every /media request then downloads privately using the server-only key.
-- Direct uploads also cannot bypass the server's full image decode and normalize.
create policy covers_server_only on storage.objects as restrictive for all
to anon, authenticated using (bucket_id <> 'covers') with check (bucket_id <> 'covers');

create function public.save_post(p_post jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  previous public.posts%rowtype;
  saved public.posts%rowtype;
  exists_already boolean;
  expected_version integer;
  violated_constraint text;
begin
  if not public.is_owner() then
    raise exception using message = 'forbidden', errcode = 'P0001';
  end if;
  if jsonb_typeof(p_post) <> 'object'
    or jsonb_typeof(p_post->'version') is distinct from 'number'
    or (p_post->>'version') !~ '^[0-9]+$'
    or (p_post->>'version')::numeric not between 0 and 2147483646
    or jsonb_typeof(p_post->'id') is distinct from 'string'
    or jsonb_typeof(p_post->'slug') is distinct from 'string'
    or jsonb_typeof(p_post->'category') is distinct from 'string'
    or jsonb_typeof(p_post->'status') is distinct from 'string'
    or jsonb_typeof(p_post->'cover') is distinct from 'string'
    or jsonb_typeof(p_post->'coverKind') is distinct from 'string'
    or not public.valid_translation(p_post->'ru')
    or not public.valid_translation(p_post->'en') then
    raise exception using message = 'invalid_content', errcode = 'P0001';
  end if;
  expected_version := (p_post->>'version')::integer;
  if p_post->>'status' = 'published' and (
    p_post->>'cover' = '' or not public.complete_translation(p_post->'ru')
    or not public.complete_translation(p_post->'en')
  ) then
    raise exception using message = 'translation_required', errcode = 'P0001';
  end if;
  if p_post->>'cover' like '/media/%' and not exists (
    select 1 from public.media m
    join storage.objects o on o.bucket_id = 'covers' and o.name = m.key
    where m.key = substring(p_post->>'cover' from 8) and m.owner_id = auth.uid()
  ) then
    raise exception using message = 'cover_missing', errcode = 'P0001';
  end if;
  select * into previous from public.posts where id = p_post->>'id' for update;
  exists_already := found;
  if (exists_already and previous.version <> expected_version)
    or (not exists_already and expected_version <> 0) then
    raise exception using message = 'stale', errcode = 'P0001';
  end if;
  if exists_already and previous.slug <> p_post->>'slug' then
    raise exception using message = 'slug_locked', errcode = 'P0001';
  end if;
  if exists_already then
    update public.posts set category = p_post->>'category', status = p_post->>'status',
      cover = p_post->>'cover', cover_kind = p_post->>'coverKind',
      ru = p_post->'ru', en = p_post->'en', version = previous.version + 1,
      updated_at = clock_timestamp(),
      published_at = case when p_post->>'status' = 'published'
        then coalesce(previous.published_at, clock_timestamp()) else previous.published_at end
    where id = previous.id returning * into saved;
  else
    insert into public.posts (id,slug,category,status,cover,cover_kind,ru,en,version,published_at)
    values (p_post->>'id',p_post->>'slug',p_post->>'category',p_post->>'status',
      p_post->>'cover',p_post->>'coverKind',p_post->'ru',p_post->'en',1,
      case when p_post->>'status' = 'published' then clock_timestamp() else null end)
    returning * into saved;
  end if;
  return to_jsonb(saved);
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'posts_slug_key' then
      raise exception using message = 'slug_exists', errcode = 'P0001';
    end if;
    raise exception using message = 'stale', errcode = 'P0001';
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using message = 'invalid_content', errcode = 'P0001';
end;
$$;
revoke all on function public.save_post(jsonb) from public, anon, authenticated;
grant execute on function public.save_post(jsonb) to authenticated;

create table public.auth_rate_limits (
  key text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);
create index auth_rate_limits_expiry on public.auth_rate_limits(expires_at);
alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from public, anon, authenticated;
grant all on public.auth_rate_limits to service_role;

create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  current_attempts integer;
begin
  if p_key is null or length(p_key) not between 1 and 200
    or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 3600 then
    raise exception 'invalid rate limit';
  end if;
  delete from public.auth_rate_limits where expires_at < now() - interval '1 day';
  insert into public.auth_rate_limits (key, attempts, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    attempts = case when public.auth_rate_limits.expires_at <= now()
      then 1 else least(public.auth_rate_limits.attempts + 1, 1000000) end,
    expires_at = case when public.auth_rate_limits.expires_at <= now()
      then now() + make_interval(secs => p_window_seconds) else public.auth_rate_limits.expires_at end
  returning attempts into current_attempts;
  return current_attempts <= p_limit;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
