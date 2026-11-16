-- EXPERIMENTAL REVOKED-SESSION PROOF, DISPOSABLE LOCAL SUPABASE ONLY.
-- Do not treat this fixture as a reviewed production migration. It is applied
-- AFTER the baseline post-signout weakness is measured in real-auth-smoke.mjs.
-- The prototype preserves existing permissive RLS and adds a restrictive gate.
begin;

create schema identity_private;
revoke all on schema identity_private from public, anon;
grant usage on schema identity_private to authenticated;

create function identity_private.has_live_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.user_id = (select auth.uid())
      and s.id::text = (select auth.jwt()->>'session_id')
      and (select auth.jwt()->>'role') = 'authenticated'
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
  );
$$;
revoke all on function identity_private.has_live_session() from public, anon, authenticated, service_role;
grant execute on function identity_private.has_live_session() to authenticated;

-- Restrictive policies add AND conditions to already-authorized operations.
-- They do not independently grant any user new access.
do $$
declare target regclass;
begin
  foreach target in array array[
    'public.profiles'::regclass,
    'public.entitlements'::regclass,
    'public.arcana_readings'::regclass,
    'public.arcana_reading_cards'::regclass,
    'public.arcana_journal_entries'::regclass,
    'reserve.tenants'::regclass,
    'reserve.users'::regclass,
    'reserve.memberships'::regclass,
    'reserve.roles'::regclass,
    'reserve.role_permissions'::regclass,
    'reserve.membership_roles'::regclass,
    'reserve.audit_events'::regclass
  ] loop
    execute format(
      'create policy veni_live_session_gate on %s as restrictive for all to authenticated'
      || ' using ((select identity_private.has_live_session()))'
      || ' with check ((select identity_private.has_live_session()))',
      target
    );
  end loop;
end $$;

-- The settings RPCs use SECURITY DEFINER delegates, so table RLS by itself
-- does not enforce the browser session. Both public adapters must gate first.
create or replace function public.reserve_read_tenant_business_settings(target uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case when (select identity_private.has_live_session())
    then reserve_internal.read_tenant_business_settings(target)
    else '{"error":"unauthorized"}'::jsonb end
$$;

create or replace function public.reserve_save_tenant_business_settings(
  target uuid,
  expected_revision reserve_internal.settings_wire_revision,
  display_name reserve_internal.settings_wire_text,
  timezone reserve_internal.settings_wire_text,
  default_locale reserve_internal.settings_wire_text,
  default_currency reserve_internal.settings_wire_text,
  staff_member_singular reserve_internal.settings_wire_text,
  staff_member_plural reserve_internal.settings_wire_text
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select case when (select identity_private.has_live_session())
    then reserve_internal.save_tenant_business_settings(
      $1, ($2 #>> '{}')::numeric::integer,
      $3 #>> '{}', $4 #>> '{}', $5 #>> '{}', $6 #>> '{}', $7 #>> '{}', $8 #>> '{}'
    )
    else '{"error":"unauthorized"}'::jsonb end
$$;

commit;
