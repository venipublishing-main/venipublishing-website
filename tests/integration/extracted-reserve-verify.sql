-- Run only against a second, empty disposable PostgreSQL CI database.
-- The source website tables are deliberately not copied. This proves schema
-- and domain-data portability, NOT independent Supabase Auth/Storage readiness.
do $$
begin
  if to_regclass('public.profiles') is not null
    or to_regclass('public.arcana_cards') is not null
    or to_regclass('public.products') is not null then
    raise exception 'Reserve extraction unexpectedly imported Veni website objects';
  end if;

  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve') <> 8
    or (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal') <> 5 then
    raise exception 'Extracted Reserve is missing M1 or M2.1 tables';
  end if;
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve' and rowsecurity) <> 8
    or (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal' and rowsecurity) <> 5 then
    raise exception 'Reserve RLS settings were not preserved by extraction';
  end if;
  if (select count(*) from reserve.tenants) <> 2
    or (select count(*) from reserve.memberships) <> 2
    or (select count(*) from reserve.membership_roles) <> 2
    or (select count(*) from reserve.roles) <> 4
    or (select count(*) from reserve.users) <> 2 then
    raise exception 'Tenant, membership, ownership or system-role data did not survive export';
  end if;
  if (select count(*) from reserve_internal.tenant_business_settings) <> 1
    or (select count(*) from reserve_internal.tenant_business_settings_changes) <> 1 then
    raise exception 'M2.1 settings and append-only revision journal did not survive';
  end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='reserve_internal' and p.proname='save_tenant_business_settings')
    is distinct from 'reserve_settings_executor' then
    raise exception 'Export lost the RLS-bound ownership of the settings writer';
  end if;
  if to_regprocedure('reserve_internal.has_capability(uuid,text)') is null
    or has_schema_privilege('anon','reserve','USAGE')
    or has_schema_privilege('anon','reserve_internal','USAGE')
    or not has_schema_privilege('authenticated','reserve','USAGE') then
    raise exception 'Exported helpers or schema privileges differ from source';
  end if;
end $$;

-- Both tenants must still be isolated after the schema/data-only restore.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$
begin
  if (select count(*) from reserve.tenants) <> 1
    or (select count(*) from reserve.memberships) <> 1
    or not reserve_internal.has_capability('11111111-1111-4111-8111-111111111111','tenant.read')
    or reserve_internal.has_capability('22222222-2222-4222-8222-222222222222','tenant.read') then
    raise exception 'Exported Reserve does not retain cross-tenant isolation';
  end if;
end $$;
rollback;

select 'Reserve M1 + M2.1 private domain extracted; RLS, owner and settings records preserved' as extraction_result;
