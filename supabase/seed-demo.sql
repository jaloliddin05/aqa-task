-- Run in Supabase SQL Editor as the default postgres role after applying
-- schema.sql on a new database or upgrade-demo.sql on an existing database.
-- Sign up in the app first and replace the example email below.
begin;

do $$
declare
  account_id uuid;
  target_email constant text := 'replace-with-your-app-email@example.com';
begin
  select id into strict account_id from auth.users where lower(email) = lower(target_email);
  perform set_config('request.jwt.claim.sub', account_id::text, true);
  perform public.load_demo();
exception
  when no_data_found then
    raise exception 'No account for %. Sign up in the app and update target_email.', target_email;
end $$;

commit;
