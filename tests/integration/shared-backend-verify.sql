-- All checks fail closed with a PostgreSQL exception on regression.
do $$
declare
  before_row website_before%rowtype;
begin
  select * into strict before_row from website_before;
  if (select count(*) from public.profiles) <> before_row.profiles
     or (select count(*) from public.products) <> before_row.products
     or (select count(*) from public.entitlements) <> before_row.entitlements
     or (select count(*) from public.arcana_cards) <> before_row.cards
     or (select count(*) from public.arcana_readings) <> before_row.readings
     or (select count(*) from pg_catalog.pg_tables where schemaname = 'public') <> before_row.public_tables then
    raise exception 'Website table counts changed during Reserve M1 import';
  end if;
  if (select md5(string_agg(id::text || coalesce(display_name,''), '|' order by id)) from public.profiles)
     is distinct from before_row.profiles_digest
     or (select md5(string_agg(slug || ':' || status, '|' order by slug)) from public.products)
     is distinct from before_row.products_digest
     or (select md5(string_agg(slug || ':' || status, '|' order by slug)) from public.arcana_cards)
     is distinct from before_row.cards_digest then
    raise exception 'Website identity, product or Arcana content changed';
  end if;
  if (select count(*) from pg_catalog.pg_tables where schemaname = 'reserve') <> 8
    or (select count(*) from pg_catalog.pg_tables where schemaname = 'reserve_internal') <> 2 then
    raise exception 'Reserve M1 expected eight domain and two private tables';
  end if;
  if (select count(*) from pg_catalog.pg_tables where schemaname = 'reserve' and rowsecurity) <> 8
    or (select count(*) from pg_catalog.pg_tables where schemaname = 'reserve_internal' and rowsecurity) <> 2 then
    raise exception 'Reserve row-level security is not enabled everywhere';
  end if;
  if to_regprocedure('reserve_internal.has_capability(uuid,text)') is null
    or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'Reserve capability or website onboarding functions missing';
  end if;
  if has_schema_privilege('anon','reserve','USAGE')
    or has_schema_privilege('anon','reserve_internal','USAGE')
    or has_table_privilege('anon','reserve.tenants','SELECT') then
    raise exception 'Reserve tenant data is exposed to the anonymous role';
  end if;
  if not has_schema_privilege('authenticated','public','USAGE')
    or not has_table_privilege('authenticated','public.profiles','SELECT') then
    raise exception 'Website public access was revoked by Reserve';
  end if;
end $$;

-- Populate two realistic owners, obeying Reserve's SERIALIZABLE and deferred
-- active-owner integrity triggers. All identities are synthetic.
begin transaction isolation level serializable;
insert into reserve.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into reserve.tenants (id, status) values
  ('11111111-1111-4111-8111-111111111111','SETUP'),
  ('22222222-2222-4222-8222-222222222222','SETUP');
insert into reserve.memberships (id, tenant_id, user_id, status) values
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE'),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE');
insert into reserve.membership_roles (membership_id,role_id) values
  ('33333333-3333-4333-8333-333333333333','10000000-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444','10000000-0000-4000-8000-000000000001');
commit;

-- Simulate a JWT for Owner A. The website's profile and Reserve's tenant
-- queries must both resolve to the same auth.uid(), without exposing Tenant B.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'Website RLS did not select only Owner A profile';
  end if;
  if (select count(*) from reserve.tenants) <> 1
    or (select count(*) from reserve.memberships) <> 1 then
    raise exception 'Reserve RLS cross-tenant leak or denied Owner A';
  end if;
  if not reserve_internal.has_capability('11111111-1111-4111-8111-111111111111', 'tenant.read')
    or reserve_internal.has_capability('22222222-2222-4222-8222-222222222222', 'tenant.read') then
    raise exception 'Reserve capability check leaks across tenants';
  end if;
end $$;
commit;

-- Inserting a new Veni account must still run the original website profile
-- trigger even after importing Reserve (no extra Reserve sign-up trigger).
insert into auth.users (id, email) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','new-user@example.invalid');
do $$ begin
  if not exists (select 1 from public.profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
    raise exception 'Website auth signup trigger was broken';
  end if;
end $$;

-- Record the known account deletion blocker rather than ignoring it:
-- existing Reserve user FK RESTRICTs direct auth.users deletion.
do $$ begin
  begin
    delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'Direct deletion unexpectedly succeeded; re-audit lifecycle hooks';
  exception when foreign_key_violation then
    null; -- Expected until the shared account deletion orchestrator is built.
  end;
end $$;

select 'website account + Arcana preserved, Reserve SQL applied, tenant A/B RLS enforced' as integration_result;
