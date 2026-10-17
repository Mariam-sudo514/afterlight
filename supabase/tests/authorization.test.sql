begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Every fixture and the temporary owner assignment is rolled back. Run against
-- the dedicated test stack; these tests never persist changes to real articles.
create temporary table test_context as select
  gen_random_uuid() as owner_id,
  gen_random_uuid() as other_id,
  gen_random_uuid() as owner_session,
  gen_random_uuid() as other_session,
  'test-' || gen_random_uuid() as draft_id,
  'test-' || gen_random_uuid() as published_id,
  gen_random_uuid()::text || '.webp' as cover_key;
grant select on test_context to anon, authenticated, service_role;
insert into auth.users (id, email, email_confirmed_at)
select owner_id, owner_id::text || '@afterlight.test', now() from test_context
union all select other_id, other_id::text || '@afterlight.test', now() from test_context;
insert into auth.sessions (id, user_id)
select owner_session, owner_id from test_context
union all select other_session, other_id from test_context;
insert into public.app_owner(singleton, user_id) select true, owner_id from test_context
on conflict (singleton) do update set user_id = excluded.user_id;

create function pg_temp.test_post(post_id text, post_version integer default 0, post_status text default 'draft')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', post_id, 'slug', post_id, 'category', 'analysis', 'status', post_status,
    'cover', '/assets/archive.webp', 'coverKind', 'illustration', 'version', post_version,
    'ru', jsonb_build_object('title','Тестовая статья','excerpt','Описание тестовой статьи.',
      'body','Текст только для проверки прав доступа. Не настоящий материал журнала.',
      'coverCaption','Тестовая иллюстрация.'),
    'en', jsonb_build_object('title','Test article','excerpt','Description of a test article.',
      'body','Content only for access control testing. This is not a real journal article.',
      'coverCaption','Test illustration.')
  );
$$;
insert into public.posts(id,slug,category,status,cover,cover_kind,ru,en,published_at)
select published_id,published_id,'analysis','published','/assets/archive.webp','illustration',
  pg_temp.test_post(published_id)->'ru',pg_temp.test_post(published_id)->'en',now()
from test_context;
insert into public.media(key,content_type,size,owner_id,width,height)
select cover_key,'image/webp',100,owner_id,10,10 from test_context;
insert into storage.objects(bucket_id,name) select 'covers',cover_key from test_context;

select ok(not (select public from storage.buckets where id = 'covers'), 'cover bucket is private');
select ok(not has_table_privilege('anon','public.posts','INSERT'), 'guest has no posts insert grant');
select ok(not has_table_privilege('authenticated','public.posts','UPDATE'), 'owner cannot bypass save RPC');
select ok(not has_table_privilege('authenticated','public.app_owner','UPDATE'), 'client cannot assign owner');
select ok(not has_table_privilege('authenticated','public.media','INSERT'), 'client cannot register unvalidated image');
select ok(not has_function_privilege('anon','public.save_post(jsonb)','EXECUTE'), 'guest cannot invoke save RPC');
select ok(not has_function_privilege('authenticated','public.consume_rate_limit(text,integer,integer)','EXECUTE'), 'rate limiter is service only');
select ok(has_schema_privilege('anon','public','USAGE'), 'guest has explicit schema usage');
select ok(has_schema_privilege('authenticated','public','USAGE'), 'session has explicit schema usage');
select ok(has_schema_privilege('service_role','public','USAGE'), 'server role has explicit schema usage');
select ok(not has_function_privilege('anon','public.valid_translation(jsonb)','EXECUTE'), 'validation helper is not a public RPC');
select ok(not has_function_privilege('authenticated','public.complete_translation(jsonb)','EXECUTE'), 'completion helper is internal to save RPC');
select ok(not has_function_privilege('anon','public.reading_minutes(text)','EXECUTE'), 'reading helper is not a public RPC');
select ok(has_function_privilege('service_role','public.valid_translation(jsonb)','EXECUTE'), 'server imports may validate table constraints');

select set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', owner_session)::text, true) from test_context;
set local role authenticated;
select ok(public.is_owner(), 'assigned UUID is owner');
select lives_ok($$select public.save_post(pg_temp.test_post(draft_id)) from test_context$$, 'owner creates draft using RPC');
select is((select count(*) from public.posts p join test_context t on p.id=t.draft_id), 1::bigint, 'owner reads draft');
select is((select count(*) from public.media m join test_context t on m.key=t.cover_key), 1::bigint, 'owner reads media metadata');
select throws_ok($$update public.posts set status='published'$$, '42501', null, 'owner direct update blocked');
select is((select count(*) from storage.objects o join test_context t on o.name=t.cover_key where o.bucket_id='covers'), 0::bigint, 'owner cannot mint durable signed cover URLs');
select throws_ok($$insert into storage.objects(bucket_id,name) values('covers','bypass.webp')$$, '42501', null, 'owner direct upload cannot bypass validation');
select lives_ok($$select public.save_post(pg_temp.test_post(draft_id,1)) from test_context$$, 'owner saves expected version');
select is((select version from public.posts p join test_context t on p.id=t.draft_id), 2, 'save increments version once');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,1)) from test_context$$, 'P0001', 'stale', 'stale save rejected');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,2) || '{"slug":"changed-slug"}'::jsonb) from test_context$$, 'P0001', 'slug_locked', 'saved slug is immutable');
select throws_ok($$select public.save_post(jsonb_set(pg_temp.test_post(draft_id,2,'published'),'{en,body}','""')) from test_context$$, 'P0001', 'translation_required', 'publication needs complete English');
select throws_ok($$select public.save_post(jsonb_set(pg_temp.test_post(draft_id,2),'{ru,title}','{}')) from test_context$$, 'P0001', 'invalid_content', 'database validates translation types');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,2) || jsonb_build_object('cover','/media/'||gen_random_uuid()||'.webp')) from test_context$$, 'P0001', 'cover_missing', 'unknown media reference rejected');
select throws_ok($$select public.save_post(pg_temp.test_post('test-'||gen_random_uuid()) || jsonb_build_object('slug',published_id)) from test_context$$, 'P0001', 'slug_exists', 'duplicate slug rejected');
select lives_ok($$select public.save_post(pg_temp.test_post(draft_id,2,'published')) from test_context$$, 'owner publishes complete bilingual article');
select lives_ok($$select public.save_post(pg_temp.test_post(draft_id,3,'draft')) from test_context$$, 'owner unpublishes article');
select is((select status from public.posts p join test_context t on p.id=t.draft_id), 'draft', 'unpublication persists');
select ok((select not (s.ru ? 'body') and not (s.en ? 'body') from public.post_summaries s join test_context t on s.id=t.draft_id), 'summary projection excludes both bodies');
reset role;

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select ok(not public.is_owner(), 'guest is not owner');
select is((select count(*) from public.posts p join test_context t on p.id=t.published_id), 1::bigint, 'guest reads published article');
select is((select count(*) from public.posts p join test_context t on p.id=t.draft_id), 0::bigint, 'guest cannot read draft after unpublication');
select is((select count(*) from public.post_summaries p join test_context t on p.id=t.draft_id), 0::bigint, 'summary view preserves RLS');
select throws_ok($$select * from public.app_owner$$, '42501', null, 'owner mapping is private');
select throws_ok($$select * from public.media$$, '42501', null, 'guest cannot enumerate media metadata');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,4)) from test_context$$, '42501', null, 'guest save blocked');
select throws_ok($$delete from public.posts$$, '42501', null, 'guest delete blocked');
select is((select count(*) from storage.objects o join test_context t on o.name=t.cover_key where o.bucket_id='covers'), 0::bigint, 'guest direct storage read blocked');
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', other_id, 'role', 'authenticated', 'session_id', other_session)::text, true) from test_context;
set local role authenticated;
select ok(not public.is_owner(), 'another verified user is not owner');
select is((select count(*) from public.posts p join test_context t on p.id=t.published_id), 1::bigint, 'other user may read published article');
select is((select count(*) from public.posts p join test_context t on p.id=t.draft_id), 0::bigint, 'other user cannot read draft');
select is((select count(*) from public.media m join test_context t on m.key=t.cover_key), 0::bigint, 'other user cannot read media metadata');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,4)) from test_context$$, 'P0001', 'forbidden', 'other user save RPC blocked');
select throws_ok($$update public.app_owner set user_id=auth.uid()$$, '42501', null, 'other user cannot take ownership');
select throws_ok($$select public.consume_rate_limit('test',1,10)$$, '42501', null, 'other user cannot clear or consume limiter');
select is((select count(*) from storage.objects o join test_context t on o.name=t.cover_key where o.bucket_id='covers'), 0::bigint, 'other user direct storage read blocked');
reset role;

delete from auth.sessions where id = (select owner_session from test_context);
select set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', owner_session)::text, true) from test_context;
set local role authenticated;
select ok(not public.is_owner(), 'revoked owner session is rejected despite unchanged JWT claims');
select throws_ok($$select public.save_post(pg_temp.test_post(draft_id,4)) from test_context$$, 'P0001', 'forbidden', 'copied JWT cannot save after logout');
select is((select count(*) from public.posts p join test_context t on p.id=t.draft_id), 0::bigint, 'copied JWT cannot read draft after logout');
reset role;

set local role service_role;
select ok(public.consume_rate_limit('test-'||txid_current(),1,10), 'service consumes first rate slot');
select ok(not public.consume_rate_limit('test-'||txid_current(),1,10), 'service rate limiter rejects excess attempt');
reset role;
select * from finish();
rollback;
