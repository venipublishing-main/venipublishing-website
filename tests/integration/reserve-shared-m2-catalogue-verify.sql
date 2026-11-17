-- Applied only after genuine loopback GoTrue sign-ups and Reserve M2 RPC calls.
-- No hosted data, secrets or real people appear in this script.
\set ON_ERROR_STOP on

do $$
declare
  table_name text;
  role_name text;
begin
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal') <> 18 then
    raise exception 'Expected M2.1, bootstrap, Theme and eight M2 catalogue private tables';
  end if;
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal'
      and rowsecurity) <> 18 then
    raise exception 'Reserve private table missing RLS';
  end if;
  for table_name in select unnest(array[
    'locations','location_events','services','service_events',
    'staff_members','staff_events','eligibility_links','eligibility_events'
  ]) loop
    if has_table_privilege('authenticated','reserve_internal.'||table_name,'SELECT') or
       has_table_privilege('anon','reserve_internal.'||table_name,'SELECT') or
       has_table_privilege('authenticated','reserve_internal.'||table_name,'INSERT') then
      raise exception 'Direct client privileges reached private Reserve %', table_name;
    end if;
  end loop;
  for role_name in select unnest(array[
    'reserve_location_executor','reserve_service_executor','reserve_staff_executor'
  ]) loop
    if not exists(select from pg_catalog.pg_roles where rolname=role_name
      and not rolcanlogin and not rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole) then
      raise exception 'Missing limited Reserve role %', role_name;
    end if;
  end loop;
  if exists(select from pg_catalog.pg_roles where rolname in
      ('veni_location_executor','veni_service_executor','veni_staff_executor')) then
    raise exception 'Global old-Reserve executor role leaked into Website project';
  end if;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('reserve_list_tenant_locations','reserve_save_tenant_location',
       'reserve_list_tenant_services','reserve_save_tenant_service',
       'reserve_list_tenant_staff','reserve_save_tenant_staff',
       'reserve_list_tenant_eligibility','reserve_save_tenant_eligibility')) <> 8 then
    raise exception 'Expected exactly eight Reserve-namespaced public entry points';
  end if;
  if (select count(*) from reserve_internal.locations) <> 1 or
     (select count(*) from reserve_internal.services) <> 1 or
     (select count(*) from reserve_internal.staff_members) <> 1 or
     (select count(*) from reserve_internal.eligibility_links) <> 3 then
    raise exception 'M2 canonical tables did not persist expected test records';
  end if;
  if (select count(*) from reserve_internal.location_events) <> 1 or
     (select count(*) from reserve_internal.service_events) <> 1 or
     (select count(*) from reserve_internal.staff_events) <> 2 or
     (select count(*) from reserve_internal.eligibility_events) <> 4 then
    raise exception 'M2 immutable event counts do not match committed revisions';
  end if;
  if (select count(*) from reserve.users) <> 2 or
     (select count(*) from public.profiles) <> 3 or
     (select count(*) from auth.users) <> 3 then
    raise exception 'Shared Auth identity graph was changed by creating staff';
  end if;
  if (select count(*) from public.arcana_cards where status='pilot') < 1 then
    raise exception 'Website Arcana pilot content lost during Reserve integration';
  end if;
  if not exists(select from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid=t.tgrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='reserve_internal' and c.relname='eligibility_events'
      and t.tgname='eligibility_events_immutable' and t.tgenabled='O') then
    raise exception 'Eligibility immutability trigger was lost';
  end if;
end $$;

select 'PASS: shared Veni account and Reserve M2 catalogue isolated with immutable history' as outcome;
