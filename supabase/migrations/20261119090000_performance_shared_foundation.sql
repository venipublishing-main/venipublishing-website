-- Generated from migration/convert.py and its reviewed SQL inputs.
begin;
create schema performance;
revoke all on schema performance from public, anon, authenticated;
grant usage on schema performance to authenticated;

-- Source: docs/initial-tenant-schema.sql
-- Sports Core development project: initial identity and tenant foundation.
-- Mirror of the Supabase migration named initial_identity_tenancy.
-- No learner, PBHS workbook, or live attendance records are seeded here.

create schema if not exists performance_internal;
revoke all on schema performance_internal from public, anon, authenticated;


create table performance.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 120),
  kind text not null check (kind in ('School', 'Club', 'Academy')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  primary_color text not null default '#185e43' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#af263b' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  highlight_color text not null default '#ffffff' check (highlight_color ~ '^#[0-9a-fA-F]{6}$'),
  badge_object_path text,
  created_at timestamptz not null default now()
);

create table performance.organization_users (
  organization_id uuid not null references performance.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table performance.sports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references performance.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table performance.squads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sport_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  season_label text not null default 'General',
  created_at timestamptz not null default now(),
  foreign key (organization_id, sport_id) references performance.sports(organization_id, id) on delete cascade,
  unique (organization_id, sport_id, id),
  unique (organization_id, sport_id, name, season_label)
);

create table performance.role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'administrator', 'head_of_sport', 'coach', 'participant')),
  sport_id uuid,
  squad_id uuid,
  assigned_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references performance.organization_users(organization_id, user_id) on delete cascade,
  foreign key (organization_id, sport_id) references performance.sports(organization_id, id) on delete cascade,
  foreign key (organization_id, sport_id, squad_id) references performance.squads(organization_id, sport_id, id) on delete cascade,
  constraint role_scope_matches_authority check (
    (role in ('owner', 'administrator', 'participant') and sport_id is null and squad_id is null)
    or (role = 'head_of_sport' and sport_id is not null and squad_id is null)
    or (role = 'coach' and sport_id is not null and squad_id is not null)
  ),
  constraint role_assignments_unique_scope unique nulls not distinct (organization_id, user_id, role, sport_id, squad_id)
);

create unique index role_assignments_one_owner_per_organization
  on performance.role_assignments (organization_id) where role = 'owner';
create index organization_users_user_idx on performance.organization_users (user_id, organization_id);
create index sports_organization_idx on performance.sports (organization_id);
create index squads_sport_idx on performance.squads (organization_id, sport_id);
create index role_assignments_user_idx on performance.role_assignments (user_id, organization_id);
create index role_assignments_sport_idx on performance.role_assignments (sport_id) where sport_id is not null;
create index role_assignments_squad_idx on performance.role_assignments (squad_id) where squad_id is not null;

-- Internal lookups deliberately bypass recursive membership RLS, but only
-- inspect the authenticated request user's own membership. The private schema
-- is not part of Supabase's exposed Data API schemas.
create function performance_internal.is_active_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from performance.organization_users as membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create function performance_internal.is_organization_owner(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from performance.organization_users as membership
    join performance.role_assignments as authority
      on authority.organization_id = membership.organization_id
      and authority.user_id = membership.user_id
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and authority.role = 'owner'
  );
$$;

revoke all on function performance_internal.is_active_member(uuid) from public, anon, authenticated;
revoke all on function performance_internal.is_organization_owner(uuid) from public, anon, authenticated;
grant usage on schema performance_internal to authenticated;
grant execute on function performance_internal.is_active_member(uuid) to authenticated;
grant execute on function performance_internal.is_organization_owner(uuid) to authenticated;

-- A verified user's first organisation creates its owner assignment in the
-- same transaction. There is no client-writable 'make myself owner' API.
create function performance_internal.bootstrap_organization_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> new.created_by then
    raise exception 'Organisation creator must be the authenticated user' using errcode = '42501';
  end if;
  insert into performance.organization_users (organization_id, user_id, status)
    values (new.id, new.created_by, 'active');
  insert into performance.role_assignments (organization_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

revoke all on function performance_internal.bootstrap_organization_owner() from public, anon, authenticated;
create trigger organizations_bootstrap_owner
  after insert on performance.organizations
  for each row execute function performance_internal.bootstrap_organization_owner();

alter table performance.organizations enable row level security;
alter table performance.organization_users enable row level security;
alter table performance.sports enable row level security;
alter table performance.squads enable row level security;
alter table performance.role_assignments enable row level security;

-- The API role needs table privileges as well as matching RLS policies.
revoke all on performance.organizations, performance.organization_users,
  performance.sports, performance.squads, performance.role_assignments from anon, authenticated;
grant select, insert on performance.organizations to authenticated;
grant update (name, kind, primary_color, secondary_color, highlight_color)
  on performance.organizations to authenticated;
grant select on performance.organization_users, performance.role_assignments to authenticated;
grant select, insert on performance.sports, performance.squads to authenticated;
grant update (name) on performance.sports to authenticated;
grant update (name, season_label) on performance.squads to authenticated;


create policy organizations_read_members on performance.organizations for select to authenticated
  using (performance_internal.is_active_member(id));
create policy organizations_create_self on performance.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy organizations_edit_owner on performance.organizations for update to authenticated
  using (performance_internal.is_organization_owner(id)) with check (performance_internal.is_organization_owner(id));

create policy organization_users_read_self_or_owner on performance.organization_users for select to authenticated
  using (user_id = (select auth.uid()) or performance_internal.is_organization_owner(organization_id));
create policy role_assignments_read_self_or_owner on performance.role_assignments for select to authenticated
  using (user_id = (select auth.uid()) or performance_internal.is_organization_owner(organization_id));

create policy sports_read_members on performance.sports for select to authenticated
  using (performance_internal.is_active_member(organization_id));
create policy sports_create_owner on performance.sports for insert to authenticated
  with check (performance_internal.is_organization_owner(organization_id));
create policy sports_edit_owner on performance.sports for update to authenticated
  using (performance_internal.is_organization_owner(organization_id))
  with check (performance_internal.is_organization_owner(organization_id));

create policy squads_read_members on performance.squads for select to authenticated
  using (performance_internal.is_active_member(organization_id));
create policy squads_create_owner on performance.squads for insert to authenticated
  with check (performance_internal.is_organization_owner(organization_id));
create policy squads_edit_owner on performance.squads for update to authenticated
  using (performance_internal.is_organization_owner(organization_id))
  with check (performance_internal.is_organization_owner(organization_id));

-- Membership, coach assignment and squad invitations remain write-closed until
-- their verified, expiring invitation acceptance path is implemented.


-- Source: docs/tenant-index-followup.sql
-- Mirror of migration tenancy_foreign_key_indexes.
-- Supabase's performance advisor identified these paths after the initial DDL.
create index organizations_creator_idx on performance.organizations (created_by);
create index role_assignments_organization_sport_squad_idx
  on performance.role_assignments (organization_id, sport_id, squad_id);


-- Source: docs/performance-domain-schema.sql
-- Veni Performance development backend: core sporting data and audit foundation.
-- Apply as the Supabase migration `performance_domain_foundation` after:
--   initial_identity_tenancy, tenancy_foreign_key_indexes.
-- This is additive. It creates NO users, athletes, PBHS data, public signup,
-- storage buckets, invitation tokens, or direct client-write permissions.

-- A division is scoped to one sport inside one organisation; it need not be an
-- age group, although age bands may be recorded where relevant.
create table performance.divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sport_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  minimum_age_years smallint check (minimum_age_years between 0 and 100),
  maximum_age_years smallint check (maximum_age_years between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (organization_id, sport_id)
    references performance.sports (organization_id, id) on delete restrict,
  constraint divisions_age_order check (
    minimum_age_years is null or maximum_age_years is null
    or minimum_age_years <= maximum_age_years
  ),
  unique (organization_id, sport_id, id),
  unique (organization_id, sport_id, name)
);

-- Existing squads remain valid; assigning a division is optional.
alter table performance.squads add column division_id uuid;
alter table performance.squads add constraint squads_division_same_sport_fk
  foreign key (organization_id, sport_id, division_id)
  references performance.divisions (organization_id, sport_id, id) on delete restrict;
create index squads_division_idx on performance.squads (organization_id, sport_id, division_id)
  where division_id is not null;

-- Each organisation owns its own athlete record, even if an authenticated
-- person later participates in several organisations. No DOB or health data.
create table performance.athletes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references performance.organizations (id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, linked_user_id)
);
create index athletes_organization_status_idx on performance.athletes (organization_id, status);

-- Historical squad membership is explicit; a new season does not overwrite
-- earlier membership. A squad's roster can also include invited guests.
create table performance.squad_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sport_id uuid not null,
  squad_id uuid not null,
  athlete_id uuid not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads (organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, athlete_id)
    references performance.athletes (organization_id, id) on delete restrict,
  constraint squad_memberships_dates_check check (left_at is null or left_at >= joined_at)
);
create unique index squad_memberships_one_active_idx
  on performance.squad_memberships (organization_id, squad_id, athlete_id)
  where left_at is null;
create index squad_memberships_squad_idx
  on performance.squad_memberships (organization_id, sport_id, squad_id);
create index squad_memberships_athlete_history_idx
  on performance.squad_memberships (organization_id, athlete_id, joined_at desc);

-- One session belongs to one squad. Confirmation must name an organisation
-- member; it cannot be represented by a lone boolean flag.
create table performance.sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sport_id uuid not null,
  squad_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  kind text not null default 'training'
    check (kind in ('training', 'match', 'testing', 'other')),
  scheduled_at timestamptz not null,
  ends_at timestamptz,
  state text not null default 'open' check (state in ('open', 'confirmed', 'cancelled')),
  created_by uuid not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  amended_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads (organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, created_by)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, confirmed_by)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  constraint sessions_time_order check (ends_at is null or ends_at >= scheduled_at),
  constraint sessions_confirmation_state check (
    (state = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
    or (state <> 'confirmed' and confirmed_by is null and confirmed_at is null)
  ),
  unique (organization_id, id),
  unique (organization_id, sport_id, squad_id, id)
);
create index sessions_squad_scheduled_idx
  on performance.sessions (organization_id, sport_id, squad_id, scheduled_at desc);
create index sessions_creator_idx on performance.sessions (organization_id, created_by);
create index sessions_confirmer_idx on performance.sessions (organization_id, confirmed_by)
  where confirmed_by is not null;

-- Snapshot the participating athletes at session creation. Attendance can
-- only refer to an athlete explicitly placed on that session's roster.
create table performance.session_roster (
  organization_id uuid not null,
  session_id uuid not null,
  athlete_id uuid not null,
  rostered_at timestamptz not null default now(),
  primary key (organization_id, session_id, athlete_id),
  foreign key (organization_id, session_id)
    references performance.sessions (organization_id, id) on delete restrict,
  foreign key (organization_id, athlete_id)
    references performance.athletes (organization_id, id) on delete restrict
);
create index session_roster_athlete_idx on performance.session_roster (organization_id, athlete_id);

-- This is only the current attendance projection. Durable mutation history
-- lives in attendance_events; a trusted future RPC must update both together.
create table performance.attendance_entries (
  organization_id uuid not null,
  session_id uuid not null,
  athlete_id uuid not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  source text not null check (source in (
    'participant_check_in', 'coach_entry', 'coach_correction'
  )),
  changed_by uuid not null,
  changed_at timestamptz not null,
  primary key (organization_id, session_id, athlete_id),
  foreign key (organization_id, session_id, athlete_id)
    references performance.session_roster (organization_id, session_id, athlete_id) on delete restrict,
  foreign key (organization_id, changed_by)
    references performance.organization_users (organization_id, user_id) on delete restrict
);
create index attendance_entries_actor_idx on performance.attendance_entries (organization_id, changed_by);

create table performance.attendance_events (
  id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  athlete_id uuid,
  kind text not null check (kind in ('entry_changed', 'session_confirmed')),
  source text check (source in (
    'participant_check_in', 'coach_entry', 'coach_correction'
  )),
  previous_status text check (previous_status in ('present', 'absent', 'late', 'excused')),
  next_status text check (next_status in ('present', 'absent', 'late', 'excused')),
  reason text,
  actor_user_id uuid not null,
  occurred_at timestamptz not null,
  foreign key (organization_id, session_id)
    references performance.sessions (organization_id, id) on delete restrict,
  foreign key (organization_id, session_id, athlete_id)
    references performance.session_roster (organization_id, session_id, athlete_id) on delete restrict,
  foreign key (organization_id, actor_user_id)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  constraint attendance_events_shape check (
    (kind = 'entry_changed' and athlete_id is not null
      and source is not null and next_status is not null)
    or (kind = 'session_confirmed' and athlete_id is null
      and source is null and previous_status is null and next_status is null)
  ),
  constraint attendance_correction_reason check (
    source is distinct from 'coach_correction'
    or (reason is not null and char_length(btrim(reason)) >= 3)
  )
);
create index attendance_events_session_time_idx
  on performance.attendance_events (organization_id, session_id, occurred_at);
create index attendance_events_roster_idx
  on performance.attendance_events (organization_id, session_id, athlete_id)
  where athlete_id is not null;
create index attendance_events_actor_idx
  on performance.attendance_events (organization_id, actor_user_id);

-- A test method has a platform ID and independent immutable method revision.
-- A bodyweight ratio is stored as the raw ratio, with its inputs in results.
create table performance.test_definitions (
  code text not null check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  revision integer not null check (revision >= 1),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  unit text not null check (char_length(btrim(unit)) between 1 and 32),
  direction text not null check (direction in ('higher', 'lower')),
  boundary_convention text not null
    check (boundary_convention in ('lower-inclusive', 'upper-inclusive')),
  measurement_kind text not null default 'direct'
    check (measurement_kind in ('direct', 'load_over_bodyweight')),
  minimum_value numeric(14,6),
  method_notes text,
  published_at timestamptz not null default now(),
  primary key (code, revision)
);

-- Validate a rule's entire band array before inserting an immutable revision.
-- Each ordered cutoff creates one additional band, matching the TypeScript
-- scoring engine; NaN/Infinity and non-1-D arrays are never valid.
create function performance_internal.scoring_bands_valid(
  p_cutoffs numeric[], p_labels text[], p_scores numeric[]
) returns boolean language plpgsql immutable strict set search_path = ''
as $$
declare
  i integer;
begin
  if coalesce(pg_catalog.array_ndims(p_cutoffs), 1) <> 1
     or coalesce(pg_catalog.array_ndims(p_labels), 1) <> 1
     or coalesce(pg_catalog.array_ndims(p_scores), 1) <> 1
     or pg_catalog.cardinality(p_cutoffs) > 50
     or pg_catalog.cardinality(p_labels) <> pg_catalog.cardinality(p_cutoffs) + 1
     or pg_catalog.cardinality(p_scores) <> pg_catalog.cardinality(p_labels)
     or coalesce(pg_catalog.array_lower(p_cutoffs, 1), 1) <> 1
     or coalesce(pg_catalog.array_lower(p_labels, 1), 1) <> 1
     or coalesce(pg_catalog.array_lower(p_scores, 1), 1) <> 1 then
    return false;
  end if;

  for i in 1 .. pg_catalog.cardinality(p_cutoffs) loop
    if p_cutoffs[i] is null
       or p_cutoffs[i]::text in ('NaN', 'Infinity', '-Infinity')
       or (i > 1 and p_cutoffs[i] <= p_cutoffs[i - 1]) then
      return false;
    end if;
  end loop;

  for i in 1 .. pg_catalog.cardinality(p_labels) loop
    if p_labels[i] is null or char_length(btrim(p_labels[i])) not between 1 and 80
       or p_scores[i] is null or p_scores[i]::text in ('NaN', 'Infinity', '-Infinity') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function performance_internal.scoring_bands_valid(numeric[], text[], numeric[])
  from public, anon, authenticated;

create table performance.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references performance.organizations (id) on delete restrict,
  sport_id uuid,
  division_id uuid,
  test_code text not null,
  test_revision integer not null,
  revision integer not null check (revision >= 1),
  published_at timestamptz not null,
  cutoffs numeric(14,6)[] not null,
  labels text[] not null,
  scores numeric(14,6)[] not null,
  weight numeric(12,6) not null check (weight >= 0),
  published_by uuid not null,
  foreign key (test_code, test_revision)
    references performance.test_definitions (code, revision) on delete restrict,
  foreign key (organization_id, sport_id)
    references performance.sports (organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id, division_id)
    references performance.divisions (organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, published_by)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  constraint scoring_rules_scope check (division_id is null or sport_id is not null),
  constraint scoring_rules_valid_bands check (
    performance_internal.scoring_bands_valid(cutoffs, labels, scores)
  ),
  unique (organization_id, id),
  unique (organization_id, id, test_code, test_revision),
  constraint scoring_rules_revision_scope_unique unique nulls not distinct
    (organization_id, test_code, sport_id, division_id, revision)
);
create index scoring_rules_test_revision_idx
  on performance.scoring_rules (test_code, test_revision);
create index scoring_rules_sport_division_idx
  on performance.scoring_rules (organization_id, sport_id, division_id)
  where sport_id is not null;
create index scoring_rules_publisher_idx
  on performance.scoring_rules (organization_id, published_by);

-- Results retain exact method/rule revisions and optional contemporaneous
-- bodyweight/load inputs. Correct a result with a new superseding row.
create table performance.test_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  athlete_id uuid not null,
  sport_id uuid,
  squad_id uuid,
  division_id uuid,
  session_id uuid,
  test_code text not null,
  test_revision integer not null,
  observed_at timestamptz not null,
  raw_value numeric(14,6) not null,
  measurement_unit text not null check (char_length(btrim(measurement_unit)) between 1 and 32),
  bodyweight_kg numeric(12,4) check (bodyweight_kg > 0),
  load_kg numeric(12,4) check (load_kg >= 0),
  scoring_rule_id uuid,
  band_index smallint check (band_index >= 0),
  scored_label text,
  scored_value numeric(14,6),
  scored_weight numeric(12,6) check (scored_weight >= 0),
  recorded_by uuid not null,
  supersedes_result_id uuid,
  correction_reason text,
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, athlete_id)
    references performance.athletes (organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id)
    references performance.sports (organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads (organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, sport_id, division_id)
    references performance.divisions (organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, sport_id, squad_id, session_id)
    references performance.sessions (organization_id, sport_id, squad_id, id) on delete restrict,
  foreign key (test_code, test_revision)
    references performance.test_definitions (code, revision) on delete restrict,
  foreign key (organization_id, scoring_rule_id, test_code, test_revision)
    references performance.scoring_rules (organization_id, id, test_code, test_revision)
    on delete restrict,
  foreign key (organization_id, recorded_by)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, supersedes_result_id)
    references performance.test_results (organization_id, id) on delete restrict,
  constraint test_results_squad_requires_sport check (squad_id is null or sport_id is not null),
  constraint test_results_division_requires_sport check (division_id is null or sport_id is not null),
  constraint test_results_session_requires_squad check (
    session_id is null or (sport_id is not null and squad_id is not null)
  ),
  constraint test_results_scoring_complete check (
    (scoring_rule_id is null and band_index is null and scored_label is null
       and scored_value is null and scored_weight is null)
    or (scoring_rule_id is not null and band_index is not null
       and scored_label is not null and char_length(btrim(scored_label)) > 0
       and scored_value is not null and scored_weight is not null)
  ),
  constraint test_results_correction_reason check (
    (supersedes_result_id is null and correction_reason is null)
    or (supersedes_result_id is not null and supersedes_result_id <> id
        and correction_reason is not null and char_length(btrim(correction_reason)) >= 3)
  ),
  unique (organization_id, id)
);
create unique index test_results_one_successor_idx
  on performance.test_results (organization_id, supersedes_result_id)
  where supersedes_result_id is not null;
create index test_results_athlete_time_idx
  on performance.test_results (organization_id, athlete_id, observed_at desc);
create index test_results_scope_idx
  on performance.test_results (organization_id, sport_id, squad_id, session_id);
create index test_results_division_idx
  on performance.test_results (organization_id, sport_id, division_id)
  where division_id is not null;
create index test_results_test_method_idx on performance.test_results (test_code, test_revision);
create index test_results_rule_idx
  on performance.test_results (organization_id, scoring_rule_id, test_code, test_revision)
  where scoring_rule_id is not null;
create index test_results_recorder_idx
  on performance.test_results (organization_id, recorded_by);

-- The present effect may be modified only by a future actor-verified RPC.
-- Every confirmed decision (including restoration to inherited defaults)
-- will append a reasoned permission event in the SAME transaction.
create table performance.permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  subject_user_id uuid not null,
  sport_id uuid,
  squad_id uuid,
  action text not null check (action in (
    'manage_scoring', 'manage_attendance', 'confirm_attendance',
    'view_squad', 'manage_permissions'
  )),
  effect text not null check (effect in ('allow', 'deny')),
  changed_by uuid not null,
  changed_at timestamptz not null,
  foreign key (organization_id, subject_user_id)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, changed_by)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, sport_id)
    references performance.sports (organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads (organization_id, sport_id, id) on delete restrict,
  constraint permission_overrides_valid_scope check (squad_id is null or sport_id is not null),
  constraint permission_overrides_unique_decision unique nulls not distinct
    (organization_id, subject_user_id, action, sport_id, squad_id)
);
create index permission_overrides_scope_idx
  on performance.permission_overrides (organization_id, sport_id, squad_id);
create index permission_overrides_changer_idx
  on performance.permission_overrides (organization_id, changed_by);

create table performance.permission_events (
  id uuid primary key,
  organization_id uuid not null,
  actor_user_id uuid not null,
  subject_user_id uuid not null,
  sport_id uuid,
  squad_id uuid,
  action text not null check (action in (
    'manage_scoring', 'manage_attendance', 'confirm_attendance',
    'view_squad', 'manage_permissions'
  )),
  previous_effect text not null check (previous_effect in ('inherit', 'allow', 'deny')),
  next_effect text not null check (next_effect in ('inherit', 'allow', 'deny')),
  reason text not null check (char_length(btrim(reason)) >= 3),
  occurred_at timestamptz not null,
  foreign key (organization_id, actor_user_id)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, subject_user_id)
    references performance.organization_users (organization_id, user_id) on delete restrict,
  foreign key (organization_id, sport_id)
    references performance.sports (organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads (organization_id, sport_id, id) on delete restrict,
  constraint permission_events_valid_scope check (squad_id is null or sport_id is not null),
  constraint permission_events_no_self_change check (actor_user_id <> subject_user_id),
  constraint permission_events_changed_effect check (previous_effect <> next_effect)
);
create index permission_events_subject_time_idx
  on performance.permission_events (organization_id, subject_user_id, occurred_at desc);
create index permission_events_actor_idx
  on performance.permission_events (organization_id, actor_user_id);
create index permission_events_scope_idx
  on performance.permission_events (organization_id, sport_id, squad_id);

-- Protect append-only evidence and published scoring versions even against
-- accidental privileged updates. Corrections must create new records.
create function performance_internal.reject_immutable_update_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Immutable Veni Performance history: insert a new event or revision'
    using errcode = '55000';
end;
$$;
revoke all on function performance_internal.reject_immutable_update_delete() from public, anon, authenticated;

create trigger attendance_events_append_only before update or delete on performance.attendance_events
  for each row execute function performance_internal.reject_immutable_update_delete();
create trigger permission_events_append_only before update or delete on performance.permission_events
  for each row execute function performance_internal.reject_immutable_update_delete();
create trigger test_definitions_append_only before update or delete on performance.test_definitions
  for each row execute function performance_internal.reject_immutable_update_delete();
create trigger scoring_rules_append_only before update or delete on performance.scoring_rules
  for each row execute function performance_internal.reject_immutable_update_delete();
create trigger test_results_append_only before update or delete on performance.test_results
  for each row execute function performance_internal.reject_immutable_update_delete();

-- Sensitive domain rows are never directly writable through the Data API.
-- Only authenticated organisation OWNERS may read tenant rows for this phase;
-- staff, participant and coach reads are deferred to reviewed scoped policies.
-- A platform-wide method catalog is read-only to authenticated users.
alter table performance.divisions enable row level security;
alter table performance.athletes enable row level security;
alter table performance.squad_memberships enable row level security;
alter table performance.sessions enable row level security;
alter table performance.session_roster enable row level security;
alter table performance.attendance_entries enable row level security;
alter table performance.attendance_events enable row level security;
alter table performance.test_definitions enable row level security;
alter table performance.scoring_rules enable row level security;
alter table performance.test_results enable row level security;
alter table performance.permission_overrides enable row level security;
alter table performance.permission_events enable row level security;

revoke all on performance.divisions, performance.athletes, performance.squad_memberships,
  performance.sessions, performance.session_roster, performance.attendance_entries,
  performance.attendance_events, performance.test_definitions, performance.scoring_rules,
  performance.test_results, performance.permission_overrides, performance.permission_events
  from anon, authenticated;

grant select on performance.divisions, performance.athletes, performance.squad_memberships,
  performance.sessions, performance.session_roster, performance.attendance_entries,
  performance.attendance_events, performance.test_definitions, performance.scoring_rules,
  performance.test_results, performance.permission_overrides, performance.permission_events
  to authenticated;

create policy divisions_owner_read on performance.divisions for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy athletes_owner_read on performance.athletes for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy squad_memberships_owner_read on performance.squad_memberships for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy sessions_owner_read on performance.sessions for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy session_roster_owner_read on performance.session_roster for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy attendance_entries_owner_read on performance.attendance_entries for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy attendance_events_owner_read on performance.attendance_events for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy test_definitions_authenticated_read on performance.test_definitions for select to authenticated
  using (true);
create policy scoring_rules_owner_read on performance.scoring_rules for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy test_results_owner_read on performance.test_results for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy permission_overrides_owner_read on performance.permission_overrides for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));
create policy permission_events_owner_read on performance.permission_events for select to authenticated
  using (performance_internal.is_organization_owner(organization_id));

-- Next migration: authenticated invitation acceptance and verified, atomic
-- attendance/scoring/delegation RPCs, each with server-side authorization,
-- idempotency, audit linkage, method/rule validation, and tenant-boundary tests.


-- Source: docs/performance-fk-index-followup.sql
-- Mirror of migration performance_fk_index_followup.
-- Supabase's performance advisor flagged an unindexed auth.users FK on
-- athletes.linked_user_id. The existing (organization_id, linked_user_id)
-- unique index is tenant-first and does not cover auth-user-first lookups.
create index athletes_linked_user_idx on performance.athletes (linked_user_id)
  where linked_user_id is not null;


-- Source: docs/secure-operations-v0.7.sql
-- Veni Performance secure operations v0.7.
-- Migration: authenticated_permission_attendance_rpcs.
-- Prerequisites: initial_identity_tenancy, performance_domain_foundation.
-- No direct table writes or public registration are enabled by this file.
-- RPC wrappers are SECURITY INVOKER; the privileged implementation is only
-- in the unexposed private schema and authenticates the request actor anew.
-- This first migration keeps ALL new RPCs uncallable by client roles until
-- the separate synthetic attack-test/activation gate is passed.

-- A credentialed session is not enough: do not accept anonymous or unverified
-- Auth identities for sensitive staff/attendance operations.
create function performance_internal.verified_actor_id()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not exists (
    select 1 from auth.users as u
    where u.id = v_actor and u.is_anonymous = false
      and u.email_confirmed_at is not null
  ) then
    raise exception 'A verified, non-anonymous account is required'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create function performance_internal.scope_exists(
  p_organization_id uuid, p_sport_id uuid, p_squad_id uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select p_organization_id is not null
    and (p_sport_id is null or exists (
      select 1 from performance.sports s
      where s.organization_id = p_organization_id and s.id = p_sport_id
    ))
    and (p_squad_id is null or (
      p_sport_id is not null and exists (
        select 1 from performance.squads q
        where q.organization_id = p_organization_id
          and q.sport_id = p_sport_id and q.id = p_squad_id
      )
    ));
$$;

-- Multiple simultaneous roles are allowed. Rank only assignments covering
-- this exact organisation/sport/squad, and only for active memberships.
create function performance_internal.user_rank_in_scope(
  p_organization_id uuid, p_user_id uuid, p_sport_id uuid, p_squad_id uuid
) returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce(max(case r.role
    when 'owner' then 5
    when 'administrator' then 4
    when 'head_of_sport' then 3
    when 'coach' then 2
    when 'participant' then 1
    else 0 end), 0)::integer
  from performance.organization_users m
  join performance.role_assignments r
    on r.organization_id = m.organization_id and r.user_id = m.user_id
  where m.organization_id = p_organization_id and m.user_id = p_user_id
    and m.status = 'active'
    and (
      r.role in ('owner', 'administrator', 'participant')
      or (r.role = 'head_of_sport' and p_sport_id is not null
        and r.sport_id = p_sport_id)
      or (r.role = 'coach' and p_sport_id is not null
        and p_squad_id is not null
        and r.sport_id = p_sport_id and r.squad_id = p_squad_id)
    );
$$;

-- One source of truth for the five delegable actions. More-specific explicit
-- decisions override defaults; a denial wins at equal specificity. Owners
-- cannot be restricted, and a coach can never become a permission editor.
create function performance_internal.can_perform(
  p_organization_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid
) returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_rank integer;
  v_effect text;
begin
  if v_actor is null or p_action is null
    or p_action not in ('manage_scoring', 'manage_attendance',
      'confirm_attendance', 'view_squad', 'manage_permissions')
    or not performance_internal.scope_exists(p_organization_id, p_sport_id, p_squad_id) then
    return false;
  end if;

  v_rank := performance_internal.user_rank_in_scope(
    p_organization_id, v_actor, p_sport_id, p_squad_id
  );
  if v_rank = 0 then return false; end if;
  if v_rank = 5 then return true; end if;

  select o.effect into v_effect
  from performance.permission_overrides o
  where o.organization_id = p_organization_id and o.subject_user_id = v_actor
    and o.action = p_action
    and (o.sport_id is null or o.sport_id = p_sport_id)
    and (o.squad_id is null or o.squad_id = p_squad_id)
  order by (case when o.squad_id is not null then 2
                 when o.sport_id is not null then 1 else 0 end) desc,
    (case when o.effect = 'deny' then 1 else 0 end) desc,
    o.id
  limit 1;

  if v_effect = 'deny' then return false; end if;
  if v_effect = 'allow' then
    return v_rank >= 2 and (p_action <> 'manage_permissions' or v_rank >= 3);
  end if;

  return v_rank >= 4
    or (v_rank = 3 and p_action in (
      'manage_scoring', 'manage_attendance', 'confirm_attendance', 'view_squad'
    ))
    or (v_rank = 2 and p_action in (
      'manage_attendance', 'confirm_attendance', 'view_squad'
    ));
end;
$$;

-- Serialize edits to one subject's permission set on their membership row.
-- The caller cannot specify actor identity or audit timestamp.
create function performance_internal.change_permission(
  p_organization_id uuid,
  p_subject_user_id uuid,
  p_action text,
  p_sport_id uuid,
  p_squad_id uuid,
  p_next_effect text,
  p_reason text,
  p_mutation_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_rank integer;
  v_subject_rank integer;
  v_previous text;
  v_existing performance.permission_events%rowtype;
  v_changed_at timestamptz := clock_timestamp();
begin
  v_actor := performance_internal.verified_actor_id();
  if p_mutation_id is null or p_subject_user_id is null or p_subject_user_id = v_actor
    or p_action is null or p_action not in (
      'manage_scoring', 'manage_attendance', 'confirm_attendance',
      'view_squad', 'manage_permissions'
    ) or p_next_effect is null
    or p_next_effect not in ('inherit', 'allow', 'deny')
    or p_reason is null or char_length(btrim(p_reason)) < 3
    or not performance_internal.scope_exists(p_organization_id, p_sport_id, p_squad_id) then
    raise exception 'Invalid or unauthorised permission request' using errcode = '42501';
  end if;

  -- An active subject with an assigned role in scope is mandatory.
  perform 1 from performance.organization_users
  where organization_id = p_organization_id and user_id = p_subject_user_id
    and status = 'active' for update;
  if not found then
    raise exception 'Active subject membership is required' using errcode = '42501';
  end if;

  v_actor_rank := performance_internal.user_rank_in_scope(
    p_organization_id, v_actor, p_sport_id, p_squad_id
  );
  v_subject_rank := performance_internal.user_rank_in_scope(
    p_organization_id, p_subject_user_id, p_sport_id, p_squad_id
  );

  if v_actor_rank < 3 or v_subject_rank = 0
    or v_actor_rank <= v_subject_rank
    or (v_actor_rank = 3 and v_subject_rank <> 2)
    or (p_action = 'manage_permissions' and v_subject_rank not in (3, 4))
    or not performance_internal.can_perform(
      p_organization_id, 'manage_permissions', p_sport_id, p_squad_id
    )
    or not performance_internal.can_perform(
      p_organization_id, p_action, p_sport_id, p_squad_id
    ) then
    raise exception 'Insufficient authority to delegate this capability'
      using errcode = '42501';
  end if;

  -- A retry is idempotent only if it repeats the SAME authenticated request.
  select * into v_existing from performance.permission_events
    where id = p_mutation_id;
  if found then
    if v_existing.organization_id = p_organization_id
      and v_existing.actor_user_id = v_actor
      and v_existing.subject_user_id = p_subject_user_id
      and v_existing.action = p_action
      and v_existing.sport_id is not distinct from p_sport_id
      and v_existing.squad_id is not distinct from p_squad_id
      and v_existing.next_effect = p_next_effect
      and v_existing.reason = btrim(p_reason) then
      return p_mutation_id;
    end if;
    raise exception 'Mutation ID has already been used for a different request'
      using errcode = '23505';
  end if;

  select effect into v_previous from performance.permission_overrides
  where organization_id = p_organization_id and subject_user_id = p_subject_user_id
    and action = p_action
    and sport_id is not distinct from p_sport_id
    and squad_id is not distinct from p_squad_id;
  if not found then v_previous := 'inherit'; end if;
  if v_previous = p_next_effect then
    raise exception 'Permission already has the requested value' using errcode = '22023';
  end if;

  if p_next_effect = 'inherit' then
    delete from performance.permission_overrides
    where organization_id = p_organization_id and subject_user_id = p_subject_user_id
      and action = p_action
      and sport_id is not distinct from p_sport_id
      and squad_id is not distinct from p_squad_id;
  else
    insert into performance.permission_overrides (
      organization_id, subject_user_id, action, sport_id, squad_id,
      effect, changed_by, changed_at
    ) values (
      p_organization_id, p_subject_user_id, p_action, p_sport_id, p_squad_id,
      p_next_effect, v_actor, v_changed_at
    )
    on conflict on constraint permission_overrides_unique_decision do update
      set effect = excluded.effect,
          changed_by = excluded.changed_by,
          changed_at = excluded.changed_at;
  end if;

  insert into performance.permission_events (
    id, organization_id, actor_user_id, subject_user_id, sport_id, squad_id,
    action, previous_effect, next_effect, reason, occurred_at
  ) values (
    p_mutation_id, p_organization_id, v_actor, p_subject_user_id,
    p_sport_id, p_squad_id, p_action, v_previous, p_next_effect,
    btrim(p_reason), v_changed_at
  );
  return p_mutation_id;
end;
$$;

create function performance_internal.record_attendance(
  p_organization_id uuid,
  p_session_id uuid,
  p_athlete_id uuid,
  p_status text,
  p_source text,
  p_reason text,
  p_mutation_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_session performance.sessions%rowtype;
  v_previous text;
  v_existing performance.attendance_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  v_actor := performance_internal.verified_actor_id();
  if p_mutation_id is null or p_athlete_id is null
    or p_status is null or p_status not in ('present', 'absent', 'late', 'excused')
    or p_source is null or p_source not in (
      'participant_check_in', 'coach_entry', 'coach_correction'
    ) then
    raise exception 'Invalid attendance request' using errcode = '22023';
  end if;

  -- Locks serialize every mutation and confirmation for one session.
  select * into v_session from performance.sessions
  where organization_id = p_organization_id and id = p_session_id for update;
  if not found then
    raise exception 'Session not found in this organisation' using errcode = '42501';
  end if;
  perform 1 from performance.session_roster
    where organization_id = p_organization_id and session_id = p_session_id
      and athlete_id = p_athlete_id;
  if not found then
    raise exception 'Athlete is not on this session roster' using errcode = '42501';
  end if;

  if p_source = 'participant_check_in' then
    if performance_internal.user_rank_in_scope(p_organization_id, v_actor,
        v_session.sport_id, v_session.squad_id) = 0
      or not exists (
        select 1 from performance.athletes a
        where a.organization_id = p_organization_id
          and a.id = p_athlete_id and a.linked_user_id = v_actor
      ) then
      raise exception 'Invalid self check-in' using errcode = '42501';
    end if;
  else
    if not performance_internal.can_perform(p_organization_id, 'manage_attendance',
      v_session.sport_id, v_session.squad_id) then
      raise exception 'Attendance authority is required' using errcode = '42501';
    end if;
  end if;

  -- Authorised retries remain idempotent even after a coach has subsequently
  -- confirmed the session. Check the event before today's state transition.
  select * into v_existing from performance.attendance_events where id = p_mutation_id;
  if found then
    if v_existing.kind = 'entry_changed'
      and v_existing.organization_id = p_organization_id
      and v_existing.session_id = p_session_id
      and v_existing.athlete_id = p_athlete_id
      and v_existing.actor_user_id = v_actor
      and v_existing.next_status = p_status
      and v_existing.source = p_source
      and v_existing.reason is not distinct from nullif(btrim(p_reason), '') then
      return p_mutation_id;
    end if;
    raise exception 'Mutation ID has already been used for a different request'
      using errcode = '23505';
  end if;

  if p_source = 'participant_check_in' then
    if v_session.state <> 'open' or p_status <> 'present' then
      raise exception 'Self check-in requires presence in an open session'
        using errcode = '22023';
    end if;
  elsif (v_session.state = 'open' and p_source <> 'coach_entry')
    or (v_session.state = 'confirmed' and p_source <> 'coach_correction')
    or v_session.state = 'cancelled'
    or (p_source = 'coach_correction'
      and (p_reason is null or char_length(btrim(p_reason)) < 3)) then
    raise exception 'Incorrect attendance state or missing correction reason'
      using errcode = '22023';
  end if;

  select status into v_previous from performance.attendance_entries
  where organization_id = p_organization_id and session_id = p_session_id
    and athlete_id = p_athlete_id;

  insert into performance.attendance_entries (
    organization_id, session_id, athlete_id, status, source, changed_by, changed_at
  ) values (
    p_organization_id, p_session_id, p_athlete_id, p_status, p_source,
    v_actor, v_now
  ) on conflict (organization_id, session_id, athlete_id) do update
    set status = excluded.status, source = excluded.source,
        changed_by = excluded.changed_by, changed_at = excluded.changed_at;

  insert into performance.attendance_events (
    id, organization_id, session_id, athlete_id, kind, source,
    previous_status, next_status, reason, actor_user_id, occurred_at
  ) values (
    p_mutation_id, p_organization_id, p_session_id, p_athlete_id,
    'entry_changed', p_source, v_previous, p_status,
    nullif(btrim(p_reason), ''), v_actor, v_now
  );
  if v_session.state = 'confirmed' then
    update performance.sessions set amended_at = v_now
    where organization_id = p_organization_id and id = p_session_id;
  end if;
  return p_mutation_id;
end;
$$;

create function performance_internal.confirm_attendance(
  p_organization_id uuid, p_session_id uuid, p_mutation_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_session performance.sessions%rowtype;
  v_existing performance.attendance_events%rowtype;
  v_roster_count integer;
  v_missing_count integer;
  v_now timestamptz := clock_timestamp();
begin
  v_actor := performance_internal.verified_actor_id();
  if p_mutation_id is null then
    raise exception 'A mutation ID is required' using errcode = '22023';
  end if;
  select * into v_session from performance.sessions
  where organization_id = p_organization_id and id = p_session_id for update;
  if not found or not performance_internal.can_perform(p_organization_id, 'confirm_attendance',
      v_session.sport_id, v_session.squad_id) then
    raise exception 'Session confirmation authority is required' using errcode = '42501';
  end if;

  select * into v_existing from performance.attendance_events where id = p_mutation_id;
  if found then
    if v_existing.kind = 'session_confirmed'
      and v_existing.organization_id = p_organization_id
      and v_existing.session_id = p_session_id
      and v_existing.actor_user_id = v_actor then
      return p_mutation_id;
    end if;
    raise exception 'Mutation ID has already been used for a different request'
      using errcode = '23505';
  end if;

  if v_session.state <> 'open' then
    raise exception 'Only an open session can be confirmed' using errcode = '22023';
  end if;
  select count(*) into v_roster_count from performance.session_roster
    where organization_id = p_organization_id and session_id = p_session_id;
  select count(*) into v_missing_count from performance.session_roster roster
    left join performance.attendance_entries entry
      on entry.organization_id = roster.organization_id
        and entry.session_id = roster.session_id
        and entry.athlete_id = roster.athlete_id
    where roster.organization_id = p_organization_id
      and roster.session_id = p_session_id and entry.athlete_id is null;
  if v_roster_count = 0 or v_missing_count > 0 then
    raise exception 'A nonempty, fully marked roster is required for confirmation'
      using errcode = '22023';
  end if;

  update performance.sessions set state = 'confirmed',
    confirmed_by = v_actor, confirmed_at = v_now
    where organization_id = p_organization_id and id = p_session_id;
  insert into performance.attendance_events (
    id, organization_id, session_id, kind, actor_user_id, occurred_at
  ) values (
    p_mutation_id, p_organization_id, p_session_id,
    'session_confirmed', v_actor, v_now
  );
  return p_mutation_id;
end;
$$;

-- API entrypoints are unprivileged wrappers, not SECURITY DEFINER functions.
-- Every staff/participant mutation is re-authorised inside performance_internal.*.
create function public.performance_change_permission(
  p_organization_id uuid, p_subject_user_id uuid, p_action text,
  p_sport_id uuid, p_squad_id uuid, p_next_effect text,
  p_reason text, p_mutation_id uuid
) returns uuid language sql volatile security invoker set search_path = ''
as $$
  select performance_internal.change_permission(
    p_organization_id, p_subject_user_id, p_action, p_sport_id,
    p_squad_id, p_next_effect, p_reason, p_mutation_id
  );
$$;

create function public.performance_record_attendance(
  p_organization_id uuid, p_session_id uuid, p_athlete_id uuid,
  p_status text, p_source text, p_reason text, p_mutation_id uuid
) returns uuid language sql volatile security invoker set search_path = ''
as $$
  select performance_internal.record_attendance(
    p_organization_id, p_session_id, p_athlete_id, p_status,
    p_source, p_reason, p_mutation_id
  );
$$;

create function public.performance_confirm_attendance(
  p_organization_id uuid, p_session_id uuid, p_mutation_id uuid
) returns uuid language sql volatile security invoker set search_path = ''
as $$
  select performance_internal.confirm_attendance(p_organization_id, p_session_id, p_mutation_id);
$$;

-- Revoke PostgreSQL's default PUBLIC EXECUTE on every new function.
revoke all on function performance_internal.verified_actor_id() from public, anon, authenticated;
revoke all on function performance_internal.scope_exists(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function performance_internal.user_rank_in_scope(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function performance_internal.can_perform(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function performance_internal.change_permission(uuid, uuid, text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function performance_internal.record_attendance(uuid, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function performance_internal.confirm_attendance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.performance_change_permission(uuid, uuid, text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.performance_record_attendance(uuid, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.performance_confirm_attendance(uuid, uuid, uuid) from public, anon, authenticated;

-- DO NOT grant EXECUTE here. This is an intentional stop-before-exposure
-- checkpoint for synthetic adversarial testing. A separately reviewed
-- activation migration may grant only the three public wrappers and their
-- matched private implementations to authenticated once tests pass.
-- Direct table-level DML revocations remain untouched.


-- Source: docs/secure-operations-activation-v0.7.sql
-- Veni Performance v0.7: activate only the reviewed authenticated RPCs.
-- Migration: activate_authenticated_permission_attendance_rpcs.
-- Preconditions: authenticated_permission_attendance_rpcs installed,
-- rollback-only adversarial QA passed, security advisor clean.

-- Public wrapper functions are SECURITY INVOKER and only return a mutation
-- UUID. Their privileged implementations live in the unexposed private
-- schema and derive actor identity solely from verified auth.uid().
-- Both layers must be executable for an invoker wrapper to work.
grant execute on function performance_internal.change_permission(uuid, uuid, text, uuid, uuid, text, text, uuid)
  to authenticated;
grant execute on function performance_internal.record_attendance(uuid, uuid, uuid, text, text, text, uuid)
  to authenticated;
grant execute on function performance_internal.confirm_attendance(uuid, uuid, uuid)
  to authenticated;

grant execute on function public.performance_change_permission(uuid, uuid, text, uuid, uuid, text, text, uuid)
  to authenticated;
grant execute on function public.performance_record_attendance(uuid, uuid, uuid, text, text, text, uuid)
  to authenticated;
grant execute on function public.performance_confirm_attendance(uuid, uuid, uuid)
  to authenticated;

-- Unauthenticated users have no execute privilege. All helper functions and
-- table DML remain explicitly closed to browser roles.


-- Source: docs/secure-scoring-rpc-v0.7.sql
-- Veni Performance v0.7 scoring-rule publication (initially closed).
-- Migration: transactional_scoring_rule_publication.
-- Test methods remain platform-owned and not writable via the browser.
-- Historical scoring rules reject UPDATE/DELETE via their existing trigger.

-- This development database is empty; every future publication now carries
-- an explicit rationale as well as the authenticated author and timestamp.
alter table performance.scoring_rules add column publication_reason text not null
  check (char_length(btrim(publication_reason)) between 3 and 1000);

create function performance_internal.publish_scoring_rule(
  p_organization_id uuid,
  p_sport_id uuid,
  p_division_id uuid,
  p_test_code text,
  p_test_revision integer,
  p_cutoffs numeric[],
  p_labels text[],
  p_scores numeric[],
  p_weight numeric,
  p_reason text,
  p_mutation_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_existing performance.scoring_rules%rowtype;
  v_revision integer;
  v_last_published_at timestamptz;
  v_now timestamptz;
begin
  v_actor := performance_internal.verified_actor_id();
  if p_mutation_id is null or p_test_code is null or p_test_revision is null
    or p_test_revision < 1 or p_cutoffs is null or p_labels is null
    or p_scores is null or p_weight is null or p_weight < 0
    or p_weight::text in ('NaN', 'Infinity', '-Infinity')
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000
    or not performance_internal.scope_exists(p_organization_id, p_sport_id, null)
    or (p_division_id is not null and (
      p_sport_id is null or not exists (
        select 1 from performance.divisions d
        where d.organization_id = p_organization_id
          and d.sport_id = p_sport_id and d.id = p_division_id
      )
    ))
    or not performance_internal.scoring_bands_valid(p_cutoffs, p_labels, p_scores) then
    raise exception 'Invalid scoring-rule publication' using errcode = '22023';
  end if;

  -- This does NOT grant a squad coach authority to change sport-wide rules.
  -- A head of sport can publish within their assigned sport if manage_scoring
  -- has not been explicitly denied; only owner/admin may publish org defaults.
  if not performance_internal.can_perform(p_organization_id, 'manage_scoring', p_sport_id, null) then
    raise exception 'Scoring publication authority is required' using errcode = '42501';
  end if;

  -- Serialise *all* publications within the organisation on its parent row,
  -- avoiding duplicate revision numbers under concurrent client requests.
  perform 1 from performance.organizations o
    where o.id = p_organization_id for update;
  if not found then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;

  select * into v_existing from performance.scoring_rules where id = p_mutation_id;
  if found then
    if v_existing.organization_id = p_organization_id
      and v_existing.sport_id is not distinct from p_sport_id
      and v_existing.division_id is not distinct from p_division_id
      and v_existing.test_code = p_test_code
      and v_existing.test_revision = p_test_revision
      and v_existing.cutoffs = p_cutoffs
      and v_existing.labels = p_labels
      and v_existing.scores = p_scores
      and v_existing.weight = p_weight
      and v_existing.published_by = v_actor
      and v_existing.publication_reason = btrim(p_reason) then
      return p_mutation_id;
    end if;
    raise exception 'Mutation ID already identifies a different scoring rule'
      using errcode = '23505';
  end if;

  perform 1 from performance.test_definitions t
  where t.code = p_test_code and t.revision = p_test_revision;
  if not found then
    raise exception 'Approved test method and revision must exist first'
      using errcode = '23503';
  end if;

  select coalesce(max(revision), 0)::integer + 1, max(published_at)
    into v_revision, v_last_published_at
  from performance.scoring_rules
  where organization_id = p_organization_id and test_code = p_test_code
    and sport_id is not distinct from p_sport_id
    and division_id is not distinct from p_division_id;

  v_now := clock_timestamp();
  if v_last_published_at is not null and v_now <= v_last_published_at then
    v_now := v_last_published_at + interval '1 microsecond';
  end if;

  insert into performance.scoring_rules (
    id, organization_id, sport_id, division_id, test_code, test_revision,
    revision, published_at, cutoffs, labels, scores, weight,
    published_by, publication_reason
  ) values (
    p_mutation_id, p_organization_id, p_sport_id, p_division_id,
    p_test_code, p_test_revision, v_revision, v_now,
    p_cutoffs, p_labels, p_scores, p_weight, v_actor, btrim(p_reason)
  );
  return p_mutation_id;
end;
$$;

create function public.performance_publish_scoring_rule(
  p_organization_id uuid, p_sport_id uuid, p_division_id uuid,
  p_test_code text, p_test_revision integer,
  p_cutoffs numeric[], p_labels text[], p_scores numeric[], p_weight numeric,
  p_reason text, p_mutation_id uuid
) returns uuid language sql volatile security invoker set search_path = ''
as $$
  select performance_internal.publish_scoring_rule(
    p_organization_id, p_sport_id, p_division_id, p_test_code,
    p_test_revision, p_cutoffs, p_labels, p_scores, p_weight,
    p_reason, p_mutation_id
  );
$$;

revoke all on function performance_internal.publish_scoring_rule(
  uuid, uuid, uuid, text, integer, numeric[], text[], numeric[], numeric, text, uuid
) from public, anon, authenticated;
revoke all on function public.performance_publish_scoring_rule(
  uuid, uuid, uuid, text, integer, numeric[], text[], numeric[], numeric, text, uuid
) from public, anon, authenticated;

-- Explicit stop gate: do not grant EXECUTE until rollback-only scoring attack
-- tests and database security advisor review have passed.


-- Source: docs/secure-scoring-activation-v0.7.sql
-- Veni Performance scoring RPC activation: synthetic QA and advisory passed.
-- Migration: activate_authenticated_scoring_publication.
-- Only verified authenticated actors with manage_scoring at the rule scope
-- can use the public SECURITY INVOKER entrypoint. There is no browser DML.

grant execute on function performance_internal.publish_scoring_rule(
  uuid, uuid, uuid, text, integer, numeric[], text[], numeric[], numeric, text, uuid
) to authenticated;
grant execute on function public.performance_publish_scoring_rule(
  uuid, uuid, uuid, text, integer, numeric[], text[], numeric[], numeric, text, uuid
) to authenticated;


-- Source: docs/verified-staff-invitations-v0.8.sql
-- Veni Performance v0.8: controlled staff invitation lifecycle (initially closed).
-- Migration: verified_owner_and_staff_invitations.
-- Does not send email, enable signup, create Auth accounts, or enrol minors.
-- No invite code/token is stored in plaintext. Tokens are returned only once.
-- The existing sports-core-dev Auth adapter is provisional until the shared
-- Veni Account identity architecture is approved and integrated.

-- Defence in depth: org creation must not rely on the browser's email check.
-- Deny still-live tokens belonging to suspended/deleted Auth identities.
create or replace function performance_internal.verified_actor_id()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not exists (
    select 1 from auth.users u where u.id = v_actor
      and u.is_anonymous = false and u.email_confirmed_at is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'A verified, active account is required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function performance_internal.bootstrap_organization_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if performance_internal.verified_actor_id() <> new.created_by then
    raise exception 'Organisation creator must be a verified authenticated user'
      using errcode = '42501';
  end if;
  insert into performance.organization_users (organization_id, user_id, status)
    values (new.id, new.created_by, 'active');
  insert into performance.role_assignments (organization_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

-- Existing v0.7 code evaluates rights for auth.uid(). Pending invitations
-- also need to re-check the original inviter's CURRENT rights at acceptance.
-- This new helper is unexposed and deliberately uncallable by API roles.
create function performance_internal.can_perform_for(
  p_user_id uuid, p_organization_id uuid, p_action text,
  p_sport_id uuid, p_squad_id uuid
) returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rank integer;
  v_effect text;
begin
  if p_user_id is null or p_action is null
    or p_action not in ('manage_scoring', 'manage_attendance',
      'confirm_attendance', 'view_squad', 'manage_permissions')
    or not performance_internal.scope_exists(p_organization_id, p_sport_id, p_squad_id) then
    return false;
  end if;
  v_rank := performance_internal.user_rank_in_scope(
    p_organization_id, p_user_id, p_sport_id, p_squad_id
  );
  if v_rank = 0 then return false; end if;
  if v_rank = 5 then return true; end if;

  select o.effect into v_effect
  from performance.permission_overrides o
  where o.organization_id = p_organization_id
    and o.subject_user_id = p_user_id
    and o.action = p_action
    and (o.sport_id is null or o.sport_id = p_sport_id)
    and (o.squad_id is null or o.squad_id = p_squad_id)
  order by (case when o.squad_id is not null then 2
                 when o.sport_id is not null then 1 else 0 end) desc,
    (case when o.effect = 'deny' then 1 else 0 end) desc, o.id
  limit 1;

  if v_effect = 'deny' then return false; end if;
  if v_effect = 'allow' then
    return v_rank >= 2 and (p_action <> 'manage_permissions' or v_rank >= 3);
  end if;
  return v_rank >= 4
    or (v_rank = 3 and p_action in (
      'manage_scoring', 'manage_attendance', 'confirm_attendance', 'view_squad'
    ))
    or (v_rank = 2 and p_action in (
      'manage_attendance', 'confirm_attendance', 'view_squad'
    ));
end;
$$;

-- Keep the existing four write RPCs consistent with invitations: there is
-- still one shared effective-rights implementation.
create or replace function performance_internal.can_perform(
  p_organization_id uuid, p_action text, p_sport_id uuid, p_squad_id uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select performance_internal.can_perform_for(
    (select auth.uid()), p_organization_id, p_action, p_sport_id, p_squad_id
  );
$$;

create table performance_internal.staff_invitations (
  id uuid primary key,
  organization_id uuid not null references performance.organizations(id) on delete restrict,
  invitee_email text not null check (
    invitee_email = lower(btrim(invitee_email))
    and char_length(invitee_email) between 5 and 254
    and invitee_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  role text not null check (role in ('administrator', 'head_of_sport', 'coach')),
  sport_id uuid,
  squad_id uuid,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  issued_by uuid not null,
  issue_reason text not null check (char_length(btrim(issue_reason)) between 3 and 1000),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'revoked')),
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  constraint staff_invite_valid_role_scope check (
    (role = 'administrator' and sport_id is null and squad_id is null)
    or (role = 'head_of_sport' and sport_id is not null and squad_id is null)
    or (role = 'coach' and sport_id is not null and squad_id is not null)
  ),
  constraint staff_invite_state_consistent check (
    (state = 'pending' and accepted_by is null and accepted_at is null
      and revoked_by is null and revoked_at is null and revoke_reason is null)
    or (state = 'accepted' and accepted_by is not null and accepted_at is not null
      and revoked_by is null and revoked_at is null and revoke_reason is null)
    or (state = 'revoked' and accepted_by is null and accepted_at is null
      and revoked_by is not null and revoked_at is not null
      and revoke_reason is not null and char_length(btrim(revoke_reason)) between 3 and 1000)
  ),
  constraint staff_invite_expiry_after_issue check (expires_at > issued_at),
  foreign key (organization_id, sport_id)
    references performance.sports(organization_id, id) on delete restrict,
  foreign key (organization_id, sport_id, squad_id)
    references performance.squads(organization_id, sport_id, id) on delete restrict,
  foreign key (organization_id, issued_by)
    references performance.organization_users(organization_id, user_id) on delete restrict,
  foreign key (organization_id, accepted_by)
    references performance.organization_users(organization_id, user_id) on delete restrict,
  foreign key (organization_id, revoked_by)
    references performance.organization_users(organization_id, user_id) on delete restrict,
  unique (organization_id, id)
);

create index staff_invitations_org_issued_idx
  on performance_internal.staff_invitations (organization_id, issued_at desc, id desc);
create index staff_invitations_pending_recipient_idx
  on performance_internal.staff_invitations (organization_id, invitee_email, expires_at)
  where state = 'pending';
create index staff_invitations_issued_by_idx
  on performance_internal.staff_invitations (organization_id, issued_by);
create index staff_invitations_accepted_by_idx
  on performance_internal.staff_invitations (organization_id, accepted_by)
  where accepted_by is not null;
create index staff_invitations_revoked_by_idx
  on performance_internal.staff_invitations (organization_id, revoked_by)
  where revoked_by is not null;
create index staff_invitations_sport_idx
  on performance_internal.staff_invitations (organization_id, sport_id) where sport_id is not null;
create index staff_invitations_squad_idx
  on performance_internal.staff_invitations (organization_id, sport_id, squad_id)
  where squad_id is not null;

create table performance_internal.staff_invitation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invitation_id uuid not null,
  event_kind text not null check (event_kind in ('issued', 'accepted', 'revoked')),
  actor_user_id uuid not null,
  reason text,
  occurred_at timestamptz not null,
  foreign key (organization_id, invitation_id)
    references performance_internal.staff_invitations(organization_id, id) on delete restrict,
  foreign key (organization_id, actor_user_id)
    references performance.organization_users(organization_id, user_id) on delete restrict,
  constraint staff_invitation_event_reason check (
    (event_kind = 'accepted' and reason is null)
    or (event_kind in ('issued', 'revoked')
      and reason is not null and char_length(btrim(reason)) between 3 and 1000)
  ),
  unique (invitation_id, event_kind)
);
create index staff_invitation_events_org_time_idx
  on performance_internal.staff_invitation_events (organization_id, occurred_at desc);
create index staff_invitation_events_actor_idx
  on performance_internal.staff_invitation_events (organization_id, actor_user_id);

create trigger staff_invitation_events_append_only
  before update or delete on performance_internal.staff_invitation_events
  for each row execute function performance_internal.reject_immutable_update_delete();

alter table performance_internal.staff_invitations enable row level security;
alter table performance_internal.staff_invitation_events enable row level security;
revoke all on performance_internal.staff_invitations, performance_internal.staff_invitation_events
  from public, anon, authenticated;

-- Active assignment + original issuer's CURRENT authority at the precise
-- role scope. Admins cannot invite peers; heads need explicitly delegated
-- manage_permissions and can issue only scoped coach invitations.
create function performance_internal.can_invite_staff(
  p_actor_id uuid, p_organization_id uuid, p_role text,
  p_sport_id uuid, p_squad_id uuid
) returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor_rank integer;
  v_target_rank integer;
begin
  if p_role is null or not performance_internal.scope_exists(
      p_organization_id, p_sport_id, p_squad_id
    ) or not (
      (p_role = 'administrator' and p_sport_id is null and p_squad_id is null)
      or (p_role = 'head_of_sport' and p_sport_id is not null and p_squad_id is null)
      or (p_role = 'coach' and p_sport_id is not null and p_squad_id is not null)
    ) or not exists (
      select 1 from auth.users u where u.id = p_actor_id
        and u.is_anonymous = false and u.email_confirmed_at is not null
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then return false;
  end if;
  v_target_rank := case p_role when 'administrator' then 4
    when 'head_of_sport' then 3 when 'coach' then 2 else 0 end;
  v_actor_rank := performance_internal.user_rank_in_scope(
    p_organization_id, p_actor_id, p_sport_id, p_squad_id
  );
  return v_actor_rank > v_target_rank and v_actor_rank >= 3
    and performance_internal.can_perform_for(
      p_actor_id, p_organization_id, 'manage_permissions',
      p_sport_id, p_squad_id
    );
end;
$$;

-- An invitation token is generated on the server, shown only once, and never
-- persisted in recoverable form. Caller-supplied request UUID prevents two
-- distinct issuance rows after a retry, but a lost token must be reissued.
create function performance_internal.issue_staff_invitation(
  p_organization_id uuid, p_invitee_email text, p_role text,
  p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer,
  p_reason text, p_request_id uuid
) returns table (invitation_id uuid, invitation_token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := performance_internal.verified_actor_id();
  v_email text := lower(btrim(p_invitee_email));
  v_actor_email text;
  v_token text;
  v_hash bytea;
  v_issued_at timestamptz;
  v_expires timestamptz;
begin
  if p_request_id is null or p_invitee_email is null
    or char_length(v_email) not between 5 and 254
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or p_lifetime_hours is null or p_lifetime_hours not between 1 and 168
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000
    or not performance_internal.can_invite_staff(
      v_actor, p_organization_id, p_role, p_sport_id, p_squad_id
    ) then
    raise exception 'Invalid or unauthorised staff invitation'
      using errcode = '42501';
  end if;
  select lower(btrim(u.email)) into v_actor_email
    from auth.users u where u.id = v_actor;
  if v_email = v_actor_email then
    raise exception 'A user cannot invite themselves' using errcode = '42501';
  end if;

  -- Serialize issuance/quota checks per organisation, without locking Auth.
  perform 1 from performance.organizations o
    where o.id = p_organization_id for update;
  if not found then raise exception 'Organisation unavailable' using errcode = '42501'; end if;
  if exists (select 1 from performance_internal.staff_invitations i where i.id = p_request_id) then
    raise exception 'An invitation was already issued for this request ID; the token cannot be recovered'
      using errcode = '23505';
  end if;
  if (select count(*) from performance_internal.staff_invitations i
      where i.organization_id = p_organization_id
        and i.issued_at >= clock_timestamp() - interval '24 hours') >= 500
    or (select count(*) from performance_internal.staff_invitations i
      where i.organization_id = p_organization_id and i.invitee_email = v_email
        and i.state = 'pending' and i.expires_at > clock_timestamp()) >= 3 then
    raise exception 'Staff invitation rate limit reached' using errcode = '22023';
  end if;

  v_issued_at := clock_timestamp();
  v_expires := v_issued_at + make_interval(hours => p_lifetime_hours);
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := extensions.digest(decode(v_token, 'hex'), 'sha256');
  insert into performance_internal.staff_invitations (
    id, organization_id, invitee_email, role, sport_id, squad_id,
    token_hash, issued_by, issue_reason, issued_at, expires_at
  ) values (
    p_request_id, p_organization_id, v_email, p_role, p_sport_id, p_squad_id,
    v_hash, v_actor, btrim(p_reason), v_issued_at, v_expires
  );
  insert into performance_internal.staff_invitation_events (
    organization_id, invitation_id, event_kind, actor_user_id, reason, occurred_at
  ) values (
    p_organization_id, p_request_id, 'issued', v_actor, btrim(p_reason), v_issued_at
  );
  return query select p_request_id, v_token, v_expires;
end;
$$;

create function performance_internal.accept_staff_invitation(p_token text)
returns table (invitation_id uuid, organization_id uuid, assigned_role text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := performance_internal.verified_actor_id();
  v_email text;
  v_inv performance_internal.staff_invitations%rowtype;
  v_member_status text;
  v_issuer_rank integer;
  v_recipient_rank integer;
  v_role_assignment_id uuid;
  v_now timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation credential' using errcode = '42501';
  end if;
  select * into v_inv from performance_internal.staff_invitations i
    where i.token_hash = extensions.digest(decode(p_token, 'hex'), 'sha256')
    for update;
  if not found then
    raise exception 'Invitation not found or unavailable' using errcode = '42501';
  end if;
  -- Accepted tokens are spent: replay by that same verified identity is a
  -- read-only success, never a second role or membership insertion.
  if v_inv.state = 'accepted' and v_inv.accepted_by = v_actor then
    return query select v_inv.id, v_inv.organization_id, v_inv.role;
    return;
  end if;
  if v_inv.state <> 'pending' or v_inv.expires_at <= clock_timestamp()
    or v_inv.issued_by = v_actor then
    raise exception 'Invitation not available' using errcode = '42501';
  end if;
  select lower(btrim(u.email)) into v_email
    from auth.users u where u.id = v_actor and u.email_confirmed_at is not null
      and u.is_anonymous = false for update;
  if not found or v_email is distinct from v_inv.invitee_email then
    raise exception 'Invitation is not addressed to this verified account'
      using errcode = '42501';
  end if;

  -- Prevent a now-suspended/delegation-revoked inviter's old invitation from
  -- silently creating new authority after they lose that right.
  if not performance_internal.can_invite_staff(
    v_inv.issued_by, v_inv.organization_id, v_inv.role,
    v_inv.sport_id, v_inv.squad_id
  ) then
    raise exception 'Inviter no longer holds the required authority'
      using errcode = '42501';
  end if;
  v_issuer_rank := performance_internal.user_rank_in_scope(
    v_inv.organization_id, v_inv.issued_by, v_inv.sport_id, v_inv.squad_id
  );
  select m.status into v_member_status from performance.organization_users m
    where m.organization_id = v_inv.organization_id and m.user_id = v_actor
    for update;
  if found and v_member_status <> 'active' then
    raise exception 'A suspended membership cannot be reactivated by invitation'
      using errcode = '42501';
  end if;
  if found then
    select coalesce(max(case r.role when 'owner' then 5
        when 'administrator' then 4 when 'head_of_sport' then 3
        when 'coach' then 2 when 'participant' then 1 else 0 end), 0)
      into v_recipient_rank
    from performance.role_assignments r where r.organization_id = v_inv.organization_id
      and r.user_id = v_actor;
    if v_recipient_rank >= v_issuer_rank then
      raise exception 'Inviter cannot change an equal or higher-ranked member'
        using errcode = '42501';
    end if;
  else
    insert into performance.organization_users (organization_id, user_id, status)
      values (v_inv.organization_id, v_actor, 'active');
  end if;

  insert into performance.role_assignments (
    organization_id, user_id, role, sport_id, squad_id
  ) values (
    v_inv.organization_id, v_actor, v_inv.role, v_inv.sport_id, v_inv.squad_id
  ) on conflict on constraint role_assignments_unique_scope do nothing
    returning id into v_role_assignment_id;
  if v_role_assignment_id is null then
    raise exception 'The assigned role already exists' using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  update performance_internal.staff_invitations i set state = 'accepted', accepted_by = v_actor,
    accepted_at = v_now where i.id = v_inv.id;
  insert into performance_internal.staff_invitation_events (
    organization_id, invitation_id, event_kind, actor_user_id, occurred_at
  ) values (v_inv.organization_id, v_inv.id, 'accepted', v_actor, v_now);
  return query select v_inv.id, v_inv.organization_id, v_inv.role;
end;
$$;

create function performance_internal.revoke_staff_invitation(
  p_organization_id uuid, p_invitation_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := performance_internal.verified_actor_id();
  v_inv performance_internal.staff_invitations%rowtype;
  v_now timestamptz;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Revocation requires a reason' using errcode = '22023';
  end if;
  select * into v_inv from performance_internal.staff_invitations i
    where i.id = p_invitation_id and i.organization_id = p_organization_id
    for update;
  if not found or v_inv.state <> 'pending'
    or not performance_internal.can_invite_staff(
      v_actor, p_organization_id, v_inv.role, v_inv.sport_id, v_inv.squad_id
    ) then
    raise exception 'Invitation cannot be revoked by this actor'
      using errcode = '42501';
  end if;
  v_now := clock_timestamp();
  update performance_internal.staff_invitations i set state = 'revoked',
    revoked_by = v_actor, revoked_at = v_now, revoke_reason = btrim(p_reason)
    where i.id = v_inv.id;
  insert into performance_internal.staff_invitation_events (
    organization_id, invitation_id, event_kind, actor_user_id, reason, occurred_at
  ) values (
    p_organization_id, v_inv.id, 'revoked', v_actor, btrim(p_reason), v_now
  );
  return v_inv.id;
end;
$$;

create function performance_internal.list_staff_invitations(
  p_organization_id uuid, p_limit integer
) returns table (
  invitation_id uuid, invitee_email text, invited_role text, sport_id uuid,
  squad_id uuid, state text, issued_at timestamptz, expires_at timestamptz
) language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := performance_internal.verified_actor_id();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Page size must be between 1 and 100' using errcode = '22023';
  end if;
  return query select i.id, i.invitee_email, i.role, i.sport_id, i.squad_id,
    case when i.state = 'pending' and i.expires_at <= statement_timestamp()
      then 'expired' else i.state end,
    i.issued_at, i.expires_at
  from performance_internal.staff_invitations i
  where i.organization_id = p_organization_id
    and performance_internal.can_invite_staff(
      v_actor, i.organization_id, i.role, i.sport_id, i.squad_id
    )
  order by i.issued_at desc, i.id desc limit p_limit;
end;
$$;

-- Only these four unprivileged API facades will become callable after tests.
create function public.performance_issue_staff_invitation(
  p_organization_id uuid, p_invitee_email text, p_role text,
  p_sport_id uuid, p_squad_id uuid, p_lifetime_hours integer,
  p_reason text, p_request_id uuid
) returns table (invitation_id uuid, invitation_token text, expires_at timestamptz)
language sql volatile security invoker set search_path = ''
as $$
  select * from performance_internal.issue_staff_invitation(
    p_organization_id, p_invitee_email, p_role, p_sport_id, p_squad_id,
    p_lifetime_hours, p_reason, p_request_id
  );
$$;

create function public.performance_accept_staff_invitation(p_token text)
returns table (invitation_id uuid, organization_id uuid, assigned_role text)
language sql volatile security invoker set search_path = ''
as $$ select * from performance_internal.accept_staff_invitation(p_token); $$;

create function public.performance_revoke_staff_invitation(
  p_organization_id uuid, p_invitation_id uuid, p_reason text
) returns uuid language sql volatile security invoker set search_path = ''
as $$
  select performance_internal.revoke_staff_invitation(p_organization_id, p_invitation_id, p_reason);
$$;

create function public.performance_list_staff_invitations(
  p_organization_id uuid, p_limit integer
) returns table (
  invitation_id uuid, invitee_email text, invited_role text, sport_id uuid,
  squad_id uuid, state text, issued_at timestamptz, expires_at timestamptz
) language sql stable security invoker set search_path = ''
as $$ select * from performance_internal.list_staff_invitations(p_organization_id, p_limit); $$;

revoke all on function performance_internal.can_perform_for(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated;
revoke all on function performance_internal.can_invite_staff(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated;
revoke all on function performance_internal.issue_staff_invitation(uuid,text,text,uuid,uuid,integer,text,uuid)
  from public, anon, authenticated;
revoke all on function performance_internal.accept_staff_invitation(text)
  from public, anon, authenticated;
revoke all on function performance_internal.revoke_staff_invitation(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function performance_internal.list_staff_invitations(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.performance_issue_staff_invitation(uuid,text,text,uuid,uuid,integer,text,uuid)
  from public, anon, authenticated;
revoke all on function public.performance_accept_staff_invitation(text)
  from public, anon, authenticated;
revoke all on function public.performance_revoke_staff_invitation(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.performance_list_staff_invitations(uuid,integer)
  from public, anon, authenticated;

-- Keep API operations disabled until real Postgres authenticated-role tests,
-- adversarial scope/identity tests and advisor review pass in a rollback.


-- Source: docs/verified-staff-invitations-v0.8-followup.sql
-- Migration: staff_invitation_indexes_and_deny_policies.
-- Advisor follow-up for the initially closed v0.8 invitation tables.
-- Explicit deny policies are intentional: clients must use audited RPCs.

create index staff_invitation_events_org_invitation_idx
  on performance_internal.staff_invitation_events (organization_id, invitation_id);

create policy staff_invitations_explicit_client_deny
  on performance_internal.staff_invitations for all to anon, authenticated
  using (false) with check (false);

create policy staff_invitation_events_explicit_client_deny
  on performance_internal.staff_invitation_events for all to anon, authenticated
  using (false) with check (false);

-- No table grants are opened, and these policies do not expose anything.


-- Source: docs/verified-staff-invitations-v0.8-activation.sql
-- Migration: activate_authenticated_staff_invitations.
-- Apply only after closed-migration rollback-only tests, authenticated-role
-- API tests, zero security advisor findings and identity/privacy review.
-- Does not enable Auth signup, send email, or allow direct table DML.

grant usage on schema performance_internal to authenticated;
grant execute on function performance_internal.issue_staff_invitation(
  uuid,text,text,uuid,uuid,integer,text,uuid
) to authenticated;
grant execute on function performance_internal.accept_staff_invitation(text) to authenticated;
grant execute on function performance_internal.revoke_staff_invitation(uuid,uuid,text) to authenticated;
grant execute on function performance_internal.list_staff_invitations(uuid,integer) to authenticated;

grant execute on function public.performance_issue_staff_invitation(
  uuid,text,text,uuid,uuid,integer,text,uuid
) to authenticated;
grant execute on function public.performance_accept_staff_invitation(text) to authenticated;
grant execute on function public.performance_revoke_staff_invitation(uuid,uuid,text) to authenticated;
grant execute on function public.performance_list_staff_invitations(uuid,integer) to authenticated;

-- Helpers retain no anonymous/authenticated EXECUTE privileges.
-- Public wrappers retain SECURITY INVOKER and cannot bypass internal checks.


-- Platform registration broadens only the platform vocabulary. Account remains
-- the exclusive issuer of entitlements. No user entitlement is seeded.
alter table public.products drop constraint products_platform_check;
alter table public.products add constraint products_platform_check check (platform in
  ('veni-kids','ai-geopolitic','veni-faithful','veni-mythos','veni-arcana','buza','veni-publishing','veni-flow'));
insert into public.products(slug,title,platform,status)
values ('veni-performance','Veni Performance','veni-flow','active');

-- Each approved environment binds its own confidential Performance client explicitly.
-- The empty registry is intentional until Account registers the approved client.
create table performance_internal.oauth_clients (
  id uuid primary key references auth.oauth_clients(id) on delete cascade
);
alter table performance_internal.oauth_clients enable row level security;
revoke all on performance_internal.oauth_clients from public, anon, authenticated;

create function performance_internal.has_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join auth.sessions s on s.user_id = u.id
    join performance_internal.oauth_clients b on b.id = s.oauth_client_id
    join auth.oauth_clients c on c.id = b.id and c.deleted_at is null
    join auth.oauth_consents g on g.client_id = b.id and g.user_id = u.id and g.revoked_at is null
    join public.entitlements e on e.user_id = u.id
    join public.products p on p.id = e.product_id
    where u.id = auth.uid() and u.email_confirmed_at is not null and not u.is_anonymous
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
      and s.id::text = auth.jwt()->>'session_id' and b.id::text = auth.jwt()->>'client_id'
      and (s.not_after is null or s.not_after > now())
      and p.slug = 'veni-performance' and p.platform = 'veni-flow' and p.status = 'active'
      and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now())
  );
$$;
revoke all on function performance_internal.has_access() from public, anon, authenticated;
grant execute on function performance_internal.has_access() to authenticated;

create or replace function performance_internal.verified_actor_id()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not performance_internal.has_access() then
    raise exception 'Performance access is required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

grant execute on function performance_internal.verified_actor_id() to authenticated;
create function public.performance_current_user()
returns uuid language sql stable security invoker set search_path = '' as $$
  select case when performance_internal.has_access() then performance_internal.verified_actor_id() end;
$$;
revoke all on function public.performance_current_user() from public,anon,authenticated;
grant execute on function public.performance_current_user() to authenticated;

create function public.performance_workspace()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if not performance_internal.has_access() then
    raise exception 'Performance access is required' using errcode = '42501';
  end if;
  return jsonb_build_object('user_id',public.performance_current_user(),'organizations',coalesce((
    select jsonb_agg(to_jsonb(o) order by o.created_at desc,o.id)
      from (select id,name,kind,created_at from performance.organizations) o
    ),'[]'::jsonb),'roles',coalesce((
    select jsonb_agg(jsonb_build_object('organization_id',r.organization_id,'role',r.role))
      from performance.role_assignments r join performance.organization_users m using (organization_id,user_id)
      where r.user_id = public.performance_current_user() and m.status='active'
    ),'[]'::jsonb));
end;
$$;

create function public.performance_create_organization(p_name text,p_kind text)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare
  org_id uuid := gen_random_uuid();
begin
  if not performance_internal.has_access() then
    raise exception 'Performance access is required' using errcode = '42501';
  end if;
  insert into performance.organizations (id,name,kind,created_by)
    values (org_id,p_name,p_kind,public.performance_current_user());
  return org_id;
end;
$$;
revoke all on function public.performance_workspace(),public.performance_create_organization(text,text)
  from public,anon,authenticated;
grant execute on function public.performance_workspace(),public.performance_create_organization(text,text) to authenticated;


create policy require_performance_access on performance.athletes as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.attendance_entries as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.attendance_events as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.divisions as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.organization_users as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.organizations as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.permission_events as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.permission_overrides as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.role_assignments as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.scoring_rules as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.session_roster as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.sessions as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.sports as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.squad_memberships as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.squads as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance_internal.staff_invitation_events as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance_internal.staff_invitations as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.test_definitions as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

create policy require_performance_access on performance.test_results as restrictive for all to authenticated
  using ((select performance_internal.has_access())) with check ((select performance_internal.has_access()));

commit;
