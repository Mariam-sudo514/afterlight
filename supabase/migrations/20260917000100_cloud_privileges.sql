-- Explicit privileges also work in newly provisioned hosted projects whose
-- default schema/table grants differ from local development. No data is changed.
grant usage on schema public to anon, authenticated, service_role;

-- Pure validation helpers are internal to constraints/the owner-save RPC.
-- They do not need to be callable through the public Data API.
revoke all on function public.valid_translation(jsonb) from public, anon, authenticated;
revoke all on function public.complete_translation(jsonb) from public, anon, authenticated;
revoke all on function public.reading_minutes(text) from public, anon, authenticated;
grant execute on function public.valid_translation(jsonb) to service_role;
grant execute on function public.complete_translation(jsonb) to service_role;
grant execute on function public.reading_minutes(text) to service_role;
