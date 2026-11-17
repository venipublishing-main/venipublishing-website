-- Isolated M7 private-theme prototype; requires genuine local Supabase schema.
do $$
declare
  rpc text;
begin
  if (select count(*) from pg_catalog.pg_tables where schemaname='reserve_internal') <> 10
     or (select count(*) from pg_catalog.pg_tables
         where schemaname='reserve_internal' and rowsecurity) <> 10 then
    raise exception 'Expected ten private Reserve M1+M2+Theme tables with RLS';
  end if;
  if to_regclass('public.themes') is not null or to_regclass('public.theme_revisions') is not null
     or to_regclass('public.published_theme_assignments') is not null
     or to_regprocedure('public.publish_tenant_theme(uuid)') is not null then
    raise exception 'Theme objects or publication accidentally exposed in Website public';
  end if;
  if (select count(*) from pg_catalog.pg_roles where rolname='reserve_theme_executor'
      and not rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit
      and not rolcreatedb and not rolcreaterole) <> 1 then
    raise exception 'Theme executor is missing or overprivileged';
  end if;
  if has_schema_privilege('reserve_theme_executor','reserve_internal','CREATE')
     or pg_has_role('authenticated','reserve_theme_executor','MEMBER')
     or pg_has_role('service_role','reserve_theme_executor','MEMBER') then
    raise exception 'Theme executor is reachable through client or CREATE privilege';
  end if;
  if (select count(*) from pg_catalog.pg_proc
      where proowner='reserve_theme_executor'::regrole) <> 5 then
    raise exception 'Theme executor must own exactly five guarded private functions';
  end if;
  if (select count(*) from pg_catalog.pg_policies
      where schemaname='reserve_internal'
        and tablename in ('themes','theme_revisions','theme_revision_events','published_theme_assignments')) <> 6
     or exists(select 1 from pg_catalog.pg_policies
        where schemaname='reserve_internal' and tablename='published_theme_assignments') then
    raise exception 'Unexpected Theme RLS or publication policy';
  end if;
  if exists(select 1 from pg_catalog.pg_policies
      where schemaname='reserve_internal'
        and tablename in ('themes','theme_revisions','theme_revision_events')
        and roles<>array['reserve_theme_executor']::name[]) then
    raise exception 'Theme read/write policy unexpectedly callable by other roles';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='reserve_internal.theme_revisions'::regclass
        and tgname='theme_revisions_immutable' and tgenabled='O')
     or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='reserve_internal.theme_revision_events'::regclass
        and tgname='theme_revision_events_immutable' and tgenabled='O') then
    raise exception 'Immutable Theme revision/event triggers disabled';
  end if;
  if has_table_privilege('reserve_theme_executor','reserve_internal.published_theme_assignments',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or exists(select 1 from reserve_internal.published_theme_assignments) then
    raise exception 'Theme publication path is not closed';
  end if;
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid='reserve_internal.themes'::regclass
        and conname='themes_draft_pointer_fk' and condeferrable) <> 1 then
    raise exception 'Atomic draft revision pointer invariant missing';
  end if;
  foreach rpc in array array['reserve_list_tenant_themes(uuid)',
    'reserve_read_tenant_theme(uuid,uuid)',
    'reserve_read_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision)',
    'reserve_create_tenant_theme(uuid,reserve_internal.settings_wire_text,jsonb)',
    'reserve_save_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)'] loop
    if to_regprocedure('public.'||rpc) is null
       or has_function_privilege('anon','public.'||rpc,'EXECUTE')
       or not has_function_privilege('authenticated','public.'||rpc,'EXECUTE') then
      raise exception 'Missing or unbounded Theme public RPC: %',rpc;
    end if;
  end loop;
  if has_table_privilege('authenticated','reserve_internal.themes','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','reserve_internal.theme_revisions','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','reserve_internal.theme_revision_events','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','reserve_internal.published_theme_assignments','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('reserve_theme_executor','public.profiles','SELECT')
     or has_table_privilege('reserve_theme_executor','public.arcana_readings','SELECT') then
    raise exception 'Theme data path leaked to client or Website/Arcana';
  end if;
  if (select count(*) from public.products where slug='arcana-stage2-test') <> 1
     or (select count(*) from public.arcana_cards) = 0 then
    raise exception 'Website or Arcana resources changed during Theme setup';
  end if;
end $$;

select 'PASS: private Theme revisions/owner/capability/immutability/publication closed' as result;
