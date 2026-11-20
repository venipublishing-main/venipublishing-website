-- Account-owned staging candidate. Install with the hook disabled and Performance traffic closed.
begin;
create role performance_api nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
grant performance_api to authenticator with inherit false, set true;
grant usage on schema performance,performance_internal,public to performance_api;

grant select on performance.athletes,
  performance.attendance_entries,
  performance.attendance_events,
  performance.divisions,
  performance.organization_users,
  performance.organizations,
  performance.permission_events,
  performance.permission_overrides,
  performance.role_assignments,
  performance.scoring_rules,
  performance.session_roster,
  performance.sessions,
  performance.sports,
  performance.squad_memberships,
  performance.squads,
  performance.test_definitions,
  performance.test_results to performance_api;
grant insert on performance.organizations,performance.sports,performance.squads to performance_api;
grant update(name,kind,primary_color,secondary_color,highlight_color) on performance.organizations to performance_api;
grant update(name) on performance.sports to performance_api;
grant update(name,season_label) on performance.squads to performance_api;
grant execute on function performance_internal.accept_staff_invitation(p_token text),
  performance_internal.change_permission(p_organization_id uuid, p_subject_user_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid, p_next_effect text, p_reason text, p_mutation_id uuid),
  performance_internal.confirm_attendance(p_organization_id uuid, p_session_id uuid, p_mutation_id uuid),
  performance_internal.is_active_member(p_organization_id uuid),
  performance_internal.is_organization_owner(p_organization_id uuid),
  performance_internal.issue_staff_invitation(p_organization_id uuid, p_invitee_email text, p_role text, p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer, p_reason text, p_request_id uuid),
  performance_internal.list_staff_invitations(p_organization_id uuid, p_limit integer),
  performance_internal.publish_scoring_rule(p_organization_id uuid, p_sport_id uuid, p_division_id uuid, p_test_code text, p_test_revision integer, p_cutoffs numeric[], p_labels text[], p_scores numeric[], p_weight numeric, p_reason text, p_mutation_id uuid),
  performance_internal.record_attendance(p_organization_id uuid, p_session_id uuid, p_athlete_id uuid, p_status text, p_source text, p_reason text, p_mutation_id uuid),
  performance_internal.revoke_staff_invitation(p_organization_id uuid, p_invitation_id uuid, p_reason text),
  public.performance_accept_staff_invitation(p_token text),
  public.performance_change_permission(p_organization_id uuid, p_subject_user_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid, p_next_effect text, p_reason text, p_mutation_id uuid),
  public.performance_confirm_attendance(p_organization_id uuid, p_session_id uuid, p_mutation_id uuid),
  public.performance_issue_staff_invitation(p_organization_id uuid, p_invitee_email text, p_role text, p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer, p_reason text, p_request_id uuid),
  public.performance_list_staff_invitations(p_organization_id uuid, p_limit integer),
  public.performance_publish_scoring_rule(p_organization_id uuid, p_sport_id uuid, p_division_id uuid, p_test_code text, p_test_revision integer, p_cutoffs numeric[], p_labels text[], p_scores numeric[], p_weight numeric, p_reason text, p_mutation_id uuid),
  public.performance_record_attendance(p_organization_id uuid, p_session_id uuid, p_athlete_id uuid, p_status text, p_source text, p_reason text, p_mutation_id uuid),
  public.performance_revoke_staff_invitation(p_organization_id uuid, p_invitation_id uuid, p_reason text),
  performance_internal.verified_actor_id(),
  performance_internal.has_access(),
  public.performance_workspace(),
  public.performance_create_organization(text,text),
  public.performance_current_user() to performance_api;
revoke execute on function performance_internal.accept_staff_invitation(p_token text),
  performance_internal.change_permission(p_organization_id uuid, p_subject_user_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid, p_next_effect text, p_reason text, p_mutation_id uuid),
  performance_internal.confirm_attendance(p_organization_id uuid, p_session_id uuid, p_mutation_id uuid),
  performance_internal.is_active_member(p_organization_id uuid),
  performance_internal.is_organization_owner(p_organization_id uuid),
  performance_internal.issue_staff_invitation(p_organization_id uuid, p_invitee_email text, p_role text, p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer, p_reason text, p_request_id uuid),
  performance_internal.list_staff_invitations(p_organization_id uuid, p_limit integer),
  performance_internal.publish_scoring_rule(p_organization_id uuid, p_sport_id uuid, p_division_id uuid, p_test_code text, p_test_revision integer, p_cutoffs numeric[], p_labels text[], p_scores numeric[], p_weight numeric, p_reason text, p_mutation_id uuid),
  performance_internal.record_attendance(p_organization_id uuid, p_session_id uuid, p_athlete_id uuid, p_status text, p_source text, p_reason text, p_mutation_id uuid),
  performance_internal.revoke_staff_invitation(p_organization_id uuid, p_invitation_id uuid, p_reason text),
  public.performance_accept_staff_invitation(p_token text),
  public.performance_change_permission(p_organization_id uuid, p_subject_user_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid, p_next_effect text, p_reason text, p_mutation_id uuid),
  public.performance_confirm_attendance(p_organization_id uuid, p_session_id uuid, p_mutation_id uuid),
  public.performance_issue_staff_invitation(p_organization_id uuid, p_invitee_email text, p_role text, p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer, p_reason text, p_request_id uuid),
  public.performance_list_staff_invitations(p_organization_id uuid, p_limit integer),
  public.performance_publish_scoring_rule(p_organization_id uuid, p_sport_id uuid, p_division_id uuid, p_test_code text, p_test_revision integer, p_cutoffs numeric[], p_labels text[], p_scores numeric[], p_weight numeric, p_reason text, p_mutation_id uuid),
  public.performance_record_attendance(p_organization_id uuid, p_session_id uuid, p_athlete_id uuid, p_status text, p_source text, p_reason text, p_mutation_id uuid),
  public.performance_revoke_staff_invitation(p_organization_id uuid, p_invitation_id uuid, p_reason text),
  performance_internal.verified_actor_id(),
  performance_internal.has_access(),
  public.performance_workspace(),
  public.performance_create_organization(text,text),
  public.performance_current_user() from authenticated,anon,public;
revoke all privileges on all tables in schema performance,performance_internal from authenticated,anon,public;
revoke usage on schema performance,performance_internal from authenticated,anon,public;
do $$
declare pol record;
begin
  for pol in select schemaname,tablename,policyname from pg_policies
    where schemaname in ('performance','performance_internal') and roles=array['authenticated']::name[]
  loop execute format('alter policy %I on %I.%I to performance_api',pol.policyname,pol.schemaname,pol.tablename);
  end loop;
end;
$$;

-- Proposed Account-owned routing metadata. The hook never grants entitlement or membership.
create schema veni_account_routing;
revoke all on schema veni_account_routing from public,anon,authenticated,performance_api;
grant usage on schema veni_account_routing to supabase_auth_admin;
create table veni_account_routing.oauth_clients (
  client_id uuid primary key references auth.oauth_clients(id) on delete cascade,
  token_role text not null check (token_role in ('authenticated','performance_api'))
);
alter table veni_account_routing.oauth_clients enable row level security;
revoke all on veni_account_routing.oauth_clients from public,anon,authenticated,performance_api;
-- Auth already owns its session reads. Grant only the additional routing lookup.
grant select on veni_account_routing.oauth_clients to supabase_auth_admin;
create policy auth_reads_routes on veni_account_routing.oauth_clients
  for select to supabase_auth_admin using (true);
create function veni_account_routing.access_token(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  claims jsonb := event->'claims';
  client text := claims->>'client_id';
  session_client uuid;
  routed_role text;
begin
  select oauth_client_id into strict session_client from auth.sessions
    where id=(claims->>'session_id')::uuid and user_id=(event->>'user_id')::uuid;
  if client is not null and client is distinct from session_client::text then
    raise exception 'OAuth session mismatch';
  end if;
  if session_client is null then return jsonb_build_object('claims',claims); end if;
  select token_role into strict routed_role from veni_account_routing.oauth_clients
    where client_id=session_client;
  return jsonb_build_object('claims',jsonb_set(claims,'{role}',to_jsonb(routed_role)));
end;
$$;
revoke all on function veni_account_routing.access_token(jsonb) from public,anon,authenticated,performance_api;
grant execute on function veni_account_routing.access_token(jsonb) to supabase_auth_admin;
-- Abort the transaction on incompatible cluster defaults or inherited sibling access.
do $check$
begin
  if not has_table_privilege('supabase_auth_admin','auth.sessions','select')
    or not has_function_privilege('supabase_auth_admin','veni_account_routing.access_token(jsonb)','execute')
    or pg_has_role('performance_api','authenticated','member')
    or not exists (select from pg_auth_members where member='authenticator'::regrole
      and roleid='performance_api'::regrole and set_option and not inherit_option)
    or exists (select from pg_roles where rolname='performance_api' and
      (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole or rolcreatedb or rolreplication or rolinherit))
    or exists (select from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','reserve','reserve_internal','storage','realtime','veni_account_routing')
      and c.relkind in ('r','p','v','m') and has_table_privilege('performance_api',c.oid,'select,insert,update,delete'))
    or exists (select from pg_proc p where p.pronamespace='public'::regnamespace
      and left(p.proname,12)<>'performance_' and p.prorettype<>'trigger'::regtype
      and has_function_privilege('performance_api',p.oid,'execute'))
    or exists (select from pg_proc p where p.pronamespace='public'::regnamespace
      and left(p.proname,12)='performance_' and (p.prosecdef
      or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute')))
    or exists (select from pg_policies where schemaname in ('performance','performance_internal')
      and roles && array['authenticated','anon','public']::name[] and permissive='PERMISSIVE'
      and (qual is distinct from 'false' or with_check is distinct from 'false'))
  then raise exception 'Performance role or shared privilege preflight failed'; end if;
end;
$check$;
commit;
