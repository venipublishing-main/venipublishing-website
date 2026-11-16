-- Use only after successful two-database synthetic import.
do $$ begin
  if (select count(*) from auth.users) <> 7
    or (select count(*) from public.profiles) <> 7
    or (select count(*) from reserve.users) <> 5
    or (select count(*) from reserve.tenants) <> 2
    or (select count(*) from reserve.memberships) <> 4
    or (select count(*) from reserve.membership_roles) <> 4
    or (select count(*) from reserve.audit_events) <> 2
    or (select count(*) from reserve_internal.invitations) <> 1
    or (select count(*) from reserve_internal.invitation_roles) <> 1
    or (select count(*) from public.arcana_readings) <> 1 then
    raise exception 'Import counts, immutable audit or original Arcana readings changed';
  end if;
  if not exists(select 1 from public.profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or not exists(select 1 from public.profiles where id='d1111111-1111-4111-8111-111111111111') then
    raise exception 'Website original and imported profiles must coexist';
  end if;
  if not exists(select 1 from reserve.roles where id='50000000-0000-4000-8000-000000000001'
     and tenant_id='c1111111-1111-4111-8111-111111111111') then
    raise exception 'Custom role lost tenant ownership';
  end if;
end $$;

-- Migrated Owner A must have unified account access and ONLY Tenant A.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if (select count(*) from public.profiles) <> 1
    or (select count(*) from reserve.tenants) <> 1
    or not exists(select 1 from reserve.tenants where id='c1111111-1111-4111-8111-111111111111')
    or reserve_internal.has_capability('c2222222-2222-4222-8222-222222222222','tenant.read') then
    raise exception 'Migrated Owner A lost single-account access or crossed tenant boundary';
  end if;
end $$;
commit;

-- Custom assistant role remains scoped to Tenant A.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if (select count(*) from reserve.tenants) <> 1
    or not reserve_internal.has_capability('c1111111-1111-4111-8111-111111111111','members.read')
    or reserve_internal.has_capability('c2222222-2222-4222-8222-222222222222','members.read') then
    raise exception 'Migrated custom role lost granted capability or leaked Tenant B';
  end if;
end $$;
commit;

-- Original Website account has zero Reserve access.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if (select count(*) from public.profiles) <> 1
    or (select count(*) from reserve.tenants) <> 0
    or (select count(*) from reserve.memberships) <> 0 then
    raise exception 'Website-only identity leaked Reserve tenant data';
  end if;
end $$;
commit;

-- Explicitly retain the lifecycle blocker as a release gate: today the
-- deployed Website delete-account path cannot delete an Auth identity that
-- Reserve references ON DELETE RESTRICT. Do not silently clear its history.
do $$ begin
  begin
    delete from auth.users where id='d1111111-1111-4111-8111-111111111111';
    raise exception 'Deletion bypassed reviewed Reserve history FK blockers';
  exception when foreign_key_violation then
    null;
  end;
  if not exists(select 1 from auth.users where id='d1111111-1111-4111-8111-111111111111') then
    raise exception 'Account deletion check unexpectedly removed a user';
  end if;
end $$;

select 'PASS: separate-source cutover preserved IDs, roles, RLS and Website; lifecycle blocker remains gated' as result;
