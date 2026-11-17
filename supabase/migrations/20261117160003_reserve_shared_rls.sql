-- Veni Publishing production migration: reviewed pinned Reserve source (foundation/preview-3-m12.sql); additively isolated under reserve, reserve_internal and namespaced RPCs.
-- AR-028: read authorization only. No mutation service or public RPC.
begin;

-- Verified locally before implementation; refuse a different ownership boundary.
do $$
begin
  if current_user <> 'postgres' or exists (
    select 1 from pg_catalog.pg_tables
    where schemaname in ('reserve', 'reserve_internal') and tableowner <> 'postgres'
  ) then
    raise exception 'AR-028 requires the reviewed postgres migration/table owner';
  end if;
end;
$$;

-- Require a JSON boolean false, not a missing claim, string, or user metadata.
create function reserve_internal.business_user_id() returns uuid
language sql stable security invoker set search_path = ''
as $$
  select case when auth.jwt() -> 'is_anonymous' = 'false'::jsonb then auth.uid() end
$$;

create function reserve_internal.current_membership_id(tenant_uuid uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id from reserve.memberships m
  join reserve.users u on u.id = m.user_id
  where u.id = reserve_internal.business_user_id()
    and m.tenant_id = tenant_uuid and m.status = 'ACTIVE'
$$;

create function reserve_internal.has_active_membership(tenant_uuid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select reserve_internal.current_membership_id(tenant_uuid) is not null
$$;

-- Mapping possession only: no domain row/Staff linkage and no own -> all upgrade.
create function reserve_internal.has_capability(tenant_uuid uuid, permission_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from reserve.membership_roles mr
    join reserve.roles r on r.id = mr.role_id
    join reserve.role_permissions rp on rp.role_id = r.id
    where mr.membership_id = reserve_internal.current_membership_id(tenant_uuid)
      and (r.kind = 'SYSTEM' or (r.kind = 'CUSTOM' and r.tenant_id = tenant_uuid))
      and rp.permission_code = has_capability.permission_code
  )
$$;

-- Scoped even when called directly: foreign lifecycle is not an oracle.
create function reserve_internal.tenant_access_enabled(tenant_uuid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select reserve_internal.has_active_membership(tenant_uuid) and exists (
    select 1 from reserve.tenants t where t.id = tenant_uuid and t.status in ('SETUP', 'ACTIVE')
  )
$$;

create function reserve_internal.can_read_membership(membership_uuid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from reserve.memberships m where m.id = membership_uuid
      and reserve_internal.business_user_id() is not null
      and (m.user_id = reserve_internal.business_user_id()
        or (reserve_internal.tenant_access_enabled(m.tenant_id) and reserve_internal.has_capability(m.tenant_id, 'members.read')))
  )
$$;

create function reserve_internal.can_read_membership_roles(membership_uuid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from reserve.memberships m where m.id = membership_uuid
      and reserve_internal.tenant_access_enabled(m.tenant_id)
      and (m.id = reserve_internal.current_membership_id(m.tenant_id) or reserve_internal.has_capability(m.tenant_id, 'members.read'))
  )
$$;

create function reserve_internal.can_read_role(role_uuid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from reserve.roles r
    join reserve.memberships m on (r.kind = 'SYSTEM' or (r.kind = 'CUSTOM' and r.tenant_id = m.tenant_id))
    join reserve.users u on u.id = m.user_id
    where r.id = role_uuid and u.id = reserve_internal.business_user_id() and m.status = 'ACTIVE'
      and reserve_internal.tenant_access_enabled(m.tenant_id)
      and (exists (select 1 from reserve.membership_roles mr where mr.membership_id = m.id and mr.role_id = r.id)
        or reserve_internal.has_capability(m.tenant_id, 'members.read'))
  )
$$;

revoke all on function reserve_internal.business_user_id(), reserve_internal.current_membership_id(uuid),
  reserve_internal.has_active_membership(uuid), reserve_internal.has_capability(uuid,text),
  reserve_internal.tenant_access_enabled(uuid), reserve_internal.can_read_membership(uuid),
  reserve_internal.can_read_membership_roles(uuid), reserve_internal.can_read_role(uuid)
  from public, anon, authenticated, service_role;
grant execute on function reserve_internal.business_user_id(), reserve_internal.current_membership_id(uuid),
  reserve_internal.has_active_membership(uuid), reserve_internal.has_capability(uuid,text),
  reserve_internal.tenant_access_enabled(uuid), reserve_internal.can_read_membership(uuid),
  reserve_internal.can_read_membership_roles(uuid), reserve_internal.can_read_role(uuid) to authenticated;

-- Triggers do not require callers to have ordinary EXECUTE privileges.
revoke all on function reserve_internal.reject_mutation(), reserve_internal.role_guard(), reserve_internal.mapping_guard(),
  reserve_internal.owner_write_guard(), reserve_internal.check_owner(), reserve_internal.assignment_scope(),
  reserve_internal.invitation_guard(), reserve_internal.invitation_role_guard(), reserve_internal.invitation_nonempty(),
  reserve_internal.audit_guard() from public, anon, authenticated, service_role;

revoke create on schema reserve from public, anon, authenticated, service_role;
revoke all on schema reserve_internal from public, anon, authenticated, service_role;
grant usage on schema reserve_internal to authenticated;

revoke all on table reserve.tenants, reserve.users, reserve.memberships, reserve.permissions,
  reserve.roles, reserve.role_permissions, reserve.membership_roles, reserve.audit_events,
  reserve_internal.invitations, reserve_internal.invitation_roles from public, anon, authenticated, service_role;

-- Table REVOKE does not remove column grants. Normalize only application columns.
do $$
declare col record;
begin
  for col in select n.nspname, c.relname, a.attname
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where a.attnum > 0 and not a.attisdropped and c.relkind = 'r'
      and ((n.nspname = 'reserve' and c.relname in
        ('tenants','users','memberships','permissions','roles','role_permissions','membership_roles','audit_events'))
        or (n.nspname = 'reserve_internal' and c.relname in ('invitations','invitation_roles')))
  loop
    execute pg_catalog.format('revoke select (%I), insert (%I), update (%I), references (%I) on table %I.%I from public, anon, authenticated, service_role',
      col.attname, col.attname, col.attname, col.attname, col.nspname, col.relname);
  end loop;
end;
$$;
grant select on table reserve.tenants, reserve.users, reserve.memberships, reserve.roles,
  reserve.role_permissions, reserve.membership_roles, reserve.audit_events to authenticated;

create policy tenants_select_authenticated on reserve.tenants for select to authenticated
using ((select reserve_internal.business_user_id()) is not null
  and reserve_internal.has_active_membership(id) and reserve_internal.has_capability(id, 'tenant.read'));
create policy users_select_authenticated on reserve.users for select to authenticated
using (id = (select reserve_internal.business_user_id()));
create policy memberships_select_authenticated on reserve.memberships for select to authenticated
using ((select reserve_internal.business_user_id()) is not null and reserve_internal.can_read_membership(id));
create policy roles_select_authenticated on reserve.roles for select to authenticated
using ((select reserve_internal.business_user_id()) is not null and reserve_internal.can_read_role(id));
create policy role_permissions_select_authenticated on reserve.role_permissions for select to authenticated
using ((select reserve_internal.business_user_id()) is not null and reserve_internal.can_read_role(role_id));
create policy membership_roles_select_authenticated on reserve.membership_roles for select to authenticated
using ((select reserve_internal.business_user_id()) is not null and reserve_internal.can_read_membership_roles(membership_id));
create policy audit_events_select_authenticated on reserve.audit_events for select to authenticated
using ((select reserve_internal.business_user_id()) is not null and reserve_internal.tenant_access_enabled(tenant_id)
  and reserve_internal.has_capability(tenant_id, 'audit.read'));

grant usage on schema reserve to authenticated;
commit;
