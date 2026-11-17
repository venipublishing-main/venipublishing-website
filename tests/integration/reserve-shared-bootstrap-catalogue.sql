-- Disposable shared Website+Reserve catalogue assertions. No hosted SQL.
do $$
begin
  if to_regprocedure('public.reserve_current_reserve_user()') is null or
     to_regprocedure('public.reserve_bootstrap_setup_tenant(uuid)') is null or
     to_regprocedure('public.reserve_list_setup_tenants()') is null or
     to_regprocedure('public.reserve_read_tenant_business_settings(uuid)') is null or
     to_regclass('reserve_internal.tenant_bootstrap_requests') is null then
    raise exception 'Expected namespaced Reserve bootstrap entry points missing';
  end if;
  if to_regprocedure('public.bootstrap_setup_tenant(uuid)') is not null or
     to_regprocedure('public.current_reserve_user()') is not null or
     to_regclass('public.tenant_bootstrap_requests') is not null or
     to_regclass('private.tenant_bootstrap_requests') is not null then
    raise exception 'A standalone bootstrap object leaked into Website public/private';
  end if;
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal') <> 6
     or (select count(*) from pg_catalog.pg_tables
         where schemaname='reserve_internal' and rowsecurity) <> 6 then
    raise exception 'Reserve private M1/M2.1/M2.2 tables or RLS missing';
  end if;
  if (select count(*) from pg_catalog.pg_roles where rolname='reserve_bootstrap_executor'
      and not rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit
      and not rolcreaterole and not rolcreatedb) <> 1 then
    raise exception 'Bootstrap executor is missing or unsafe';
  end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='reserve_internal' and p.proname='bootstrap_setup_tenant')
      is distinct from 'reserve_bootstrap_executor' then
    raise exception 'Private bootstrap function must run as restricted executor';
  end if;
  if has_table_privilege('anon','reserve_internal.tenant_bootstrap_requests','SELECT')
     or has_table_privilege('authenticated','reserve_internal.tenant_bootstrap_requests','SELECT,INSERT,UPDATE,DELETE')
     or has_function_privilege('anon','public.reserve_bootstrap_setup_tenant(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.reserve_bootstrap_setup_tenant(uuid)','EXECUTE')
     or has_table_privilege('reserve_bootstrap_executor','public.profiles','SELECT')
     or has_table_privilege('reserve_bootstrap_executor','public.arcana_readings','SELECT') then
    raise exception 'Bootstrap grants leak into Website/Arcana or anonymous role';
  end if;
  if pg_has_role('authenticated','reserve_bootstrap_executor','MEMBER') or
     pg_has_role('service_role','reserve_bootstrap_executor','MEMBER') then
    raise exception 'Account clients inherit Reserve privileged execution role';
  end if;
  if (select count(*) from pg_catalog.pg_policies
      where roles=array['reserve_bootstrap_executor']::name[]) <> 12 then
    raise exception 'Expected 12 bounded bootstrap RLS policies';
  end if;
  if (select proconfig from pg_proc where oid='public.reserve_bootstrap_setup_tenant(uuid)'::regprocedure)
     is distinct from array['search_path=""','default_transaction_isolation=serializable'] then
    raise exception 'Bootstrap RPC lost SERIALIZABLE guard';
  end if;
  if not has_table_privilege('authenticated','public.profiles','SELECT') or
     (select count(*) from public.products where slug='arcana-stage2-test') <> 1 or
     (select count(*) from public.arcana_cards) = 0 then
    raise exception 'Website or Arcana initial data/grants changed';
  end if;
end $$;

select 'PASS: Reserve bootstrap isolated from Website/Arcana; RLS and privileged RPCs bounded' as candidate_result;
