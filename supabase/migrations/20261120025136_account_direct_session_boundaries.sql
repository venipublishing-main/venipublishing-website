begin;
create schema veni_account_session;
revoke all on schema veni_account_session from public, anon, authenticated, service_role;
grant usage on schema veni_account_session to authenticated;

-- The signed JWT and its live Auth session must agree on direct Website sign-in.
-- This also handles refresh tokens whose access token omits the client_id claim.
create function veni_account_session.is_direct() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.jwt()->>'client_id' is null and exists (
    select from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id::text = auth.jwt()->>'session_id' and s.user_id = auth.uid()
      and s.oauth_client_id is null and (s.not_after is null or s.not_after > statement_timestamp())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= statement_timestamp())
  )
$$;
revoke all on function veni_account_session.is_direct() from public, anon, authenticated, service_role;
grant execute on function veni_account_session.is_direct() to authenticated;
create function public.veni_account_is_direct_session() returns boolean
language sql stable security invoker set search_path = '' as $$ select veni_account_session.is_direct() $$;
revoke all on function public.veni_account_is_direct_session() from public, anon, authenticated, service_role;
grant execute on function public.veni_account_is_direct_session() to authenticated;

-- Existing owner permissions still apply. Public product and Arcana card catalogues stay readable.
do $restrict$
declare relation regclass;
begin
  foreach relation in array array['public.profiles'::regclass,'public.entitlements'::regclass,
    'public.arcana_readings'::regclass,'public.arcana_reading_cards'::regclass,'public.arcana_journal_entries'::regclass]
  loop
    execute format('create policy direct_account_session on %s as restrictive for all to authenticated
      using ((select veni_account_session.is_direct())) with check ((select veni_account_session.is_direct()))',relation);
  end loop;
end;
$restrict$;
notify pgrst,'reload schema';
commit;
