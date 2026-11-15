-- M2.1 remains a Reserve-owned feature even when installed in shared Veni.
-- All UUIDs below are synthetic identities seeded by the preceding M1 checks.
do $$
begin
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal') <> 5
    or (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal' and rowsecurity) <> 5 then
    raise exception 'M2.1 private settings relations or RLS not installed';
  end if;
  if to_regclass('public.tenant_business_settings') is not null
    or to_regclass('public.settings_reference') is not null then
    raise exception 'Reserve settings accidentally installed public tables';
  end if;
  if (select rolcanlogin or rolbypassrls or rolinherit
        from pg_catalog.pg_roles where rolname='reserve_settings_executor') then
    raise exception 'Reserve settings executor unexpectedly privileged';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='reserve_settings_executor') then
    raise exception 'Reserve-specific settings execution role missing';
  end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='reserve_internal' and p.proname='save_tenant_business_settings')
    is distinct from 'reserve_settings_executor' then
    raise exception 'Settings write function is not owned by RLS-bound executor';
  end if;
  if has_function_privilege('anon','public.reserve_read_tenant_business_settings(uuid)','EXECUTE')
    or has_table_privilege('authenticated','reserve_internal.tenant_business_settings','SELECT')
    or not has_function_privilege('authenticated','public.reserve_read_tenant_business_settings(uuid)','EXECUTE') then
    raise exception 'Settings RPC/table privileges are too broad or too narrow';
  end if;
  if (select count(*) from public.profiles) <> 3
    or (select count(*) from public.arcana_readings) <> 1 then
    raise exception 'M2.1 installation modified shared Veni account or Arcana data';
  end if;
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}';
do $$
declare
  outcome jsonb;
begin
  outcome := public.reserve_read_tenant_business_settings('11111111-1111-4111-8111-111111111111');
  if outcome->>'state' <> 'unconfigured' then
    raise exception 'Owner A did not read own unconfigured settings: %', outcome;
  end if;
  outcome := public.reserve_read_tenant_business_settings('22222222-2222-4222-8222-222222222222');
  if outcome->>'error' <> 'tenant_unavailable' then
    raise exception 'Owner A can read Tenant B settings: %', outcome;
  end if;
  outcome := public.reserve_save_tenant_business_settings(
    '11111111-1111-4111-8111-111111111111',
    '0'::jsonb::reserve_internal.settings_wire_revision,
    '"A Studio"'::jsonb::reserve_internal.settings_wire_text,
    '"Africa/Johannesburg"'::jsonb::reserve_internal.settings_wire_text,
    '"en-ZA"'::jsonb::reserve_internal.settings_wire_text,
    '"ZAR"'::jsonb::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text);
  if outcome->>'state' <> 'configured' or outcome->>'revision' <> '1'
    or outcome->'settings'->>'display_name' <> 'A Studio' then
    raise exception 'Owner A business settings create failed: %', outcome;
  end if;
  outcome := public.reserve_save_tenant_business_settings(
    '11111111-1111-4111-8111-111111111111',
    '0'::jsonb::reserve_internal.settings_wire_revision,
    '"A Studio"'::jsonb::reserve_internal.settings_wire_text,
    '"Africa/Johannesburg"'::jsonb::reserve_internal.settings_wire_text,
    '"en-ZA"'::jsonb::reserve_internal.settings_wire_text,
    '"ZAR"'::jsonb::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text);
  if outcome->>'error' <> 'revision_conflict' then
    raise exception 'M2.1 failed to detect a stale settings revision: %', outcome;
  end if;
  outcome := public.reserve_save_tenant_business_settings(
    '22222222-2222-4222-8222-222222222222',
    '0'::jsonb::reserve_internal.settings_wire_revision,
    '"Other Tenant"'::jsonb::reserve_internal.settings_wire_text,
    '"Africa/Johannesburg"'::jsonb::reserve_internal.settings_wire_text,
    '"en-ZA"'::jsonb::reserve_internal.settings_wire_text,
    '"ZAR"'::jsonb::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text,
    null::reserve_internal.settings_wire_text);
  if outcome->>'error' <> 'tenant_unavailable' then
    raise exception 'Owner A modified Tenant B business settings: %', outcome;
  end if;
end $$;
commit;

-- Superuser inspection is deliberately performed after the caller transaction.
do $$ begin
  if (select count(*) from reserve_internal.tenant_business_settings) <> 1
    or (select count(*) from reserve_internal.tenant_business_settings_changes) <> 1 then
    raise exception 'Settings revision or immutable journal did not persist';
  end if;
end $$;

-- Supabase Auth claim mismatches must fail even when the legacy subject matches.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","is_anonymous":false}';
do $$ begin
  if public.reserve_read_tenant_business_settings('11111111-1111-4111-8111-111111111111')->>'error' <> 'unauthorized' then
    raise exception 'M2.1 accepted conflicting canonical/legacy identity claims';
  end if;
end $$;
rollback;

select 'Reserve settings role/RPC isolated; tenant access, revision and Auth-claim checks passed' as m21_result;
