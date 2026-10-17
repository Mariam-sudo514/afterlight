-- READ ONLY: schema/privilege metadata only. No identities, passwords, content,
-- object bytes or credentials are returned. Run against the explicit project ref.
with history as (
  select case when to_regclass('supabase_migrations.schema_migrations') is null
    then '[]'::jsonb
    else ((xpath('//row/versions/text()', query_to_xml(
      'select coalesce(jsonb_agg(version::text), ''[]''::jsonb) as versions from supabase_migrations.schema_migrations',
      false, true, '')))[1]::text)::jsonb
    end as versions
), relations as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.reloptions, c.reltuples::bigint as estimated_rows
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('app_owner','posts','post_summaries','media','auth_rate_limits')
), routines as (
  select p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('is_owner','valid_translation','complete_translation','reading_minutes','save_post','consume_rate_limit')
), checks as (
  select
    current_setting('server_version_num')::integer >= 150000 as postgres_supported,
    (select count(*) from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name in ('id','user_id','not_after'))=3 as auth_sessions_supported,
    not exists (select 1 from jsonb_array_elements_text(history.versions) v where v not in ('20260916000100','20260917000100')) as known_history,
    history.versions ? '20260916000100' as base_tracked,
    (select count(*) from relations) as relation_count,
    (select count(*) from routines) as routine_count,
    (select count(*) from storage.buckets where id='covers') as bucket_count,
    (select count(*) from storage.buckets where id='covers' and public=false and file_size_limit=4194304)=1 as private_covers,
    (select count(*) from relations where relkind='r' and relrowsecurity)=4 as all_rls,
    (select count(*) from relations where relname='post_summaries' and relkind='v' and 'security_invoker=true'=any(reloptions))=1 as invoker_view,
    not exists (
      select 1 from relations r cross join (values ('anon'),('authenticated')) roles(name)
      where r.relkind='r' and (has_table_privilege(roles.name,r.oid,'INSERT') or has_table_privilege(roles.name,r.oid,'UPDATE') or has_table_privilege(roles.name,r.oid,'DELETE') or has_table_privilege(roles.name,r.oid,'TRUNCATE'))
    ) as client_writes_denied,
    not exists (
      select 1 from pg_policies where schemaname='public' and tablename in ('app_owner','posts','media','auth_rate_limits')
      and not (tablename='posts' and policyname='posts_read') and not (tablename='media' and policyname='media_owner_read')
    ) as no_unknown_app_policies,
    (select count(*) from pg_policies where schemaname='public' and tablename='posts' and policyname='posts_read' and cmd='SELECT'
      and regexp_replace(replace(qual,'public.',''),'\s+','','g') = '((status=''published''::text)OR(SELECTis_owner()ASis_owner))'
      and roles = array['anon','authenticated']::name[])=1 as posts_policy,
    (select count(*) from pg_policies where schemaname='public' and tablename='media' and policyname='media_owner_read' and cmd='SELECT'
      and regexp_replace(replace(qual,'public.',''),'\s+','','g') = '((SELECTis_owner()ASis_owner)AND(owner_id=(SELECTauth.uid()ASuid)))'
      and roles = array['authenticated']::name[])=1 as media_policy,
    (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='covers_server_only' and permissive='RESTRICTIVE' and cmd='ALL'
      and regexp_replace(qual,'\s+','','g') = '(bucket_id<>''covers''::text)'
      and regexp_replace(with_check,'\s+','','g') = '(bucket_id<>''covers''::text)'
      and roles = array['anon','authenticated']::name[])=1 as restrictive_storage,
    (select count(*) from routines where proname in ('is_owner','save_post','consume_rate_limit') and prosecdef and proconfig @> array['search_path=""'])=3 as protected_functions
  from history
), result as (
  select checks.*, (postgres_supported and auth_sessions_supported and known_history and (
    (not base_tracked and relation_count=0 and routine_count=0 and bucket_count=0)
    or (base_tracked and relation_count=5 and routine_count=6 and private_covers and all_rls and invoker_view and client_writes_denied and no_unknown_app_policies and posts_policy and media_policy and restrictive_storage and protected_functions)
  )) as safe_to_apply from checks
)
select jsonb_build_object(
  'safe_to_apply', result.safe_to_apply,
  'checks', to_jsonb(result),
  'migration_versions', history.versions,
  'relations', (select coalesce(jsonb_agg(to_jsonb(r)-'oid'),'[]'::jsonb) from relations r),
  'policies', (select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'using',qual,'check',with_check)),'[]'::jsonb) from pg_policies where (schemaname='public' and tablename in ('app_owner','posts','media','auth_rate_limits')) or (schemaname='storage' and policyname='covers_server_only'))
) as report from result cross join history;
