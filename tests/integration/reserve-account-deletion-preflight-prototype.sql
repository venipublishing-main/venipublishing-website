-- DISPOSABLE CI PROTOTYPE, NOT A HOSTED MIGRATION.
-- A self-only, security-invoker Reserve account-deletion preflight.
-- This does not delete/anonymise users, memberships, invites or audit history.
-- It must be regenerated as an approved migration before hosted deployment.

begin;
create function public.reserve_account_deletion_preflight()
returns text
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  caller uuid := reserve_internal.business_user_id();
begin
  -- An authenticated PostgREST role alone is not sufficient: anonymous Auth
  -- users assume that role too. Require a real, non-anonymous JWT claim.
  if caller is null then
    return 'REAUTH_REQUIRED';
  end if;

  -- As an invoker, the function can only see the caller's membership and
  -- assignment rows under the existing Reserve M1.2 RLS policies. There is
  -- no user-supplied UUID and hence no cross-user identifier oracle.
  if exists (
    select 1 from reserve.memberships m
    join reserve.membership_roles mr on mr.membership_id = m.id
    where m.user_id = caller and m.status = 'ACTIVE'
      and mr.role_id = '10000000-0000-4000-8000-000000000001'::uuid
  ) then
    return 'OWNER_TRANSFER_REQUIRED';
  end if;

  -- Even revoked memberships and an unassigned identity projection currently
  -- keep ON DELETE RESTRICT references to auth.users. No implicit cascade.
  if exists (select 1 from reserve.users u where u.id = caller) then
    return 'RESERVE_HISTORY_REVIEW_REQUIRED';
  end if;

  return 'RESERVE_CLEAR';
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default: explicitly revoke it
-- before granting a self-only RPC to non-anonymous authenticated sessions.
revoke all on function public.reserve_account_deletion_preflight()
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_account_deletion_preflight()
  to authenticated;
comment on function public.reserve_account_deletion_preflight() is
  'DRAFT local-only self-deletion preflight. Not a legal retention decision or an account deletion operation.';
commit;
