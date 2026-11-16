-- Transactional, rollback-only simulation of removing both Reserve schemas
-- from the synthetic shared database. Never run this on a hosted project.
begin;
-- String-bodied SQL functions can survive schema removal, so explicitly
-- remove the two public Reserve adapters before dropping private domains.
drop function public.reserve_read_tenant_business_settings(uuid);
drop schema reserve_internal, reserve cascade;
drop role reserve_settings_executor;
do $$
begin
  if to_regclass('reserve.tenants') is not null
    or to_regclass('reserve_internal.invitations') is not null then
    raise exception 'Reserve removal drill left domain tables behind';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
      on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'reserve_%')
    or exists (select 1 from pg_catalog.pg_roles where rolname='reserve_settings_executor') then
    raise exception 'Reserve removal left an exposed RPC or a custom role behind';
  end if;
  if (select count(*) from public.profiles) <> 3
    or (select count(*) from public.arcana_readings) <> 1
    or (select count(*) from public.products) < 1
    or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'Removing Reserve damaged the website account or Arcana foundation';
  end if;
  if not exists (select 1 from public.profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or not exists (select 1 from public.profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
    raise exception 'Removing Reserve damaged existing or newly-created Veni users';
  end if;
end $$;
rollback;

-- The rollback means the original shared database still has Reserve intact.
do $$ begin
  if to_regclass('reserve.tenants') is null
    or (select count(*) from public.profiles) <> 3
    or not exists (select 1 from pg_catalog.pg_roles where rolname='reserve_settings_executor') then
    raise exception 'Reversible Reserve removal drill failed to roll back cleanly';
  end if;
end $$;

select 'Website unaffected by simulated Reserve removal; shared database rolled back' as removal_result;
