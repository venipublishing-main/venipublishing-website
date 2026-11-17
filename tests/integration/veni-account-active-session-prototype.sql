-- DISPOSABLE CI PROTOTYPE ONLY. DO NOT DEPLOY OR RUN ON HOSTED SUPABASE.
-- The JWT's session_id is authenticated by PostgREST, but its signature can
-- remain valid after sign-out. Check that its backing auth.sessions row exists.
-- This is a self-only boolean, never an arbitrary-user/session lookup API.
-- Any production implementation needs its own reviewed migration and advisor
-- run, plus a measured solution to the final check-to-delete race.

begin;
create function public.veni_account_active_session()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  session_text text;
begin
  if actor is null or claims is null or
     coalesce(claims->>'is_anonymous','false') = 'true' then
    return false;
  end if;

  session_text := claims->>'session_id';
  if session_text is null or session_text !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return exists (
    select 1 from auth.sessions s
    where s.id = session_text::uuid
      and s.user_id = actor
      and (s.not_after is null or s.not_after > current_timestamp)
  );
exception when invalid_text_representation then
  return false;
end;
$$;

-- Function owner can read auth.sessions; authenticated clients cannot.
-- Privileged exposure is limited to the caller's own non-parameterised result.
revoke all on function public.veni_account_active_session()
  from public, anon, authenticated, service_role;
grant execute on function public.veni_account_active_session()
  to authenticated;
comment on function public.veni_account_active_session() is
  'DRAFT self-only live Auth session status. Synthetic CI prototype; not a hosted migration.';
commit;
