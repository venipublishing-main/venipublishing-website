-- Veni Publishing production migration: reviewed pinned Reserve source (foundation/preview-6-m7-private-theme.sql); additively isolated under reserve, reserve_internal and namespaced RPCs.
-- M7 foundation, local only: stable Themes and immutable, private draft snapshots.
-- No public assignment or asset upload operation is exposed by this migration.
begin;
create role reserve_theme_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
grant reserve_theme_executor to postgres;
grant usage on schema reserve_internal to reserve_theme_executor;
grant execute on function reserve_internal.authenticated_session_user(),
  reserve_internal.tenant_access_enabled(uuid), reserve_internal.has_capability(uuid,text),
  reserve_internal.current_membership_id(uuid), reserve_internal.settings_text(text,integer)
  to reserve_theme_executor;

-- V1 stores a deliberately small typed token set. Never store tenant CSS,
-- HTML, script, remote font URLs or client-side blob URLs as Theme content.
create function reserve_internal.normalized_theme_tokens(value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'object' then return null; end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(value))<>3
    or pg_catalog.jsonb_typeof(value->'primary') is distinct from 'string'
    or pg_catalog.jsonb_typeof(value->'accent') is distinct from 'string'
    or pg_catalog.jsonb_typeof(value->'typography') is distinct from 'string'
    or (value->>'primary') collate "C" !~ '^#[0-9a-fA-F]{6}$'
    or (value->>'accent') collate "C" !~ '^#[0-9a-fA-F]{6}$'
    or value->>'typography' not in ('system','serif') then return null; end if;
  return pg_catalog.jsonb_build_object('primary',pg_catalog.lower((value->>'primary') collate "C"),
    'accent',pg_catalog.lower((value->>'accent') collate "C"),'typography',value->>'typography');
end
$$;
revoke all on function reserve_internal.normalized_theme_tokens(jsonb) from public,anon,authenticated,service_role;
grant execute on function reserve_internal.normalized_theme_tokens(jsonb) to reserve_theme_executor;

create table reserve_internal.themes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references reserve.tenants on update restrict on delete restrict,
  name text not null check(reserve_internal.settings_text(name,80) is not distinct from name),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','ARCHIVED')),
  draft_revision integer check(draft_revision between 1 and 2147483647),
  created_by_user_id uuid not null references reserve.users on update restrict on delete restrict,
  created_by_membership_id uuid not null references reserve.memberships on update restrict on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create unique index themes_active_name_idx on reserve_internal.themes(tenant_id,pg_catalog.lower(name collate "C")) where status='ACTIVE';

create table reserve_internal.theme_revisions (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null,
  theme_id uuid not null,
  revision integer not null check(revision between 1 and 2147483647),
  schema_version integer not null default 1 check(schema_version=1),
  tokens jsonb not null check(reserve_internal.normalized_theme_tokens(tokens) is not distinct from tokens),
  source_revision integer,
  actor_user_id uuid not null references reserve.users on update restrict on delete restrict,
  actor_membership_id uuid not null references reserve.memberships on update restrict on delete restrict,
  created_at timestamptz not null default now(),
  primary key(tenant_id,theme_id,revision),
  foreign key(tenant_id,theme_id) references reserve_internal.themes(tenant_id,id) on update restrict on delete restrict,
  foreign key(tenant_id,theme_id,source_revision)
    references reserve_internal.theme_revisions(tenant_id,theme_id,revision) on update restrict on delete restrict,
  check(source_revision is null or source_revision<revision)
);
alter table reserve_internal.themes add constraint themes_draft_pointer_fk
  foreign key(tenant_id,id,draft_revision)
  references reserve_internal.theme_revisions(tenant_id,theme_id,revision)
  on update no action on delete no action deferrable initially deferred;

create table reserve_internal.theme_revision_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  theme_id uuid not null,
  revision integer not null,
  action text not null check(action in ('theme.created','theme.revision.saved')),
  actor_user_id uuid not null references reserve.users on update restrict on delete restrict,
  actor_membership_id uuid not null references reserve.memberships on update restrict on delete restrict,
  occurred_at timestamptz not null default now(),
  correlation_id uuid not null default gen_random_uuid(),
  unique(tenant_id,theme_id,revision),
  foreign key(tenant_id,theme_id,revision)
    references reserve_internal.theme_revisions(tenant_id,theme_id,revision) on update restrict on delete restrict,
  check(action=case when revision=1 then 'theme.created' else 'theme.revision.saved' end)
);
create index theme_revisions_actor_idx on reserve_internal.theme_revisions(actor_user_id);
create index theme_events_tenant_time_idx on reserve_internal.theme_revision_events(tenant_id,occurred_at,id);
create trigger theme_revisions_immutable before update or delete or truncate on reserve_internal.theme_revisions
  for each statement execute function reserve_internal.reject_mutation();
create trigger theme_revision_events_immutable before update or delete or truncate on reserve_internal.theme_revision_events
  for each statement execute function reserve_internal.reject_mutation();

-- Reserved, closed publication pointer. No route or database role can set it
-- during the private-draft slice. Later publish must validate atomically.
create table reserve_internal.published_theme_assignments (
  tenant_id uuid primary key references reserve.tenants on update restrict on delete restrict,
  theme_id uuid not null,
  revision integer not null,
  generation integer not null check(generation>0),
  assigned_at timestamptz not null,
  actor_user_id uuid not null references reserve.users on update restrict on delete restrict,
  foreign key(tenant_id,theme_id,revision)
    references reserve_internal.theme_revisions(tenant_id,theme_id,revision) on update restrict on delete restrict
);
alter table reserve_internal.themes enable row level security;
alter table reserve_internal.theme_revisions enable row level security;
alter table reserve_internal.theme_revision_events enable row level security;
alter table reserve_internal.published_theme_assignments enable row level security;
revoke all on reserve_internal.themes,reserve_internal.theme_revisions,reserve_internal.theme_revision_events,
  reserve_internal.published_theme_assignments from public,anon,authenticated,service_role;
grant select,insert on reserve_internal.themes,reserve_internal.theme_revisions to reserve_theme_executor;
grant update(draft_revision,updated_at) on reserve_internal.themes to reserve_theme_executor;
grant insert on reserve_internal.theme_revision_events to reserve_theme_executor;
create policy theme_read on reserve_internal.themes for select to reserve_theme_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.read'));
create policy theme_create on reserve_internal.themes for insert to reserve_theme_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.edit')
    and reserve_internal.has_capability(tenant_id,'themes.read')
    and created_by_user_id=reserve_internal.authenticated_session_user()
    and created_by_membership_id=reserve_internal.current_membership_id(tenant_id));
create policy theme_update on reserve_internal.themes for update to reserve_theme_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.edit'))
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.edit'));
create policy theme_revision_read on reserve_internal.theme_revisions for select to reserve_theme_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.read'));
create policy theme_revision_append on reserve_internal.theme_revisions for insert to reserve_theme_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.edit')
    and reserve_internal.has_capability(tenant_id,'themes.read')
    and actor_user_id=reserve_internal.authenticated_session_user()
    and actor_membership_id=reserve_internal.current_membership_id(tenant_id));
create policy theme_event_append on reserve_internal.theme_revision_events for insert to reserve_theme_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'themes.edit')
    and actor_user_id=reserve_internal.authenticated_session_user()
    and actor_membership_id=reserve_internal.current_membership_id(tenant_id));

create function reserve_internal.list_tenant_themes(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if reserve_internal.authenticated_session_user() is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'themes.read'))
   then return '{"error":"tenant_unavailable"}'; end if;
 return pg_catalog.jsonb_build_object('themes',coalesce((select pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object('theme_id',t.id,'name',t.name,'status',t.status,
     'current_revision',t.draft_revision) order by t.created_at,t.id)
   from reserve_internal.themes t where t.tenant_id=target),'[]'::jsonb));
end $$;

create function reserve_internal.read_tenant_theme(target uuid,theme uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t reserve_internal.themes; r reserve_internal.theme_revisions;
begin
 if reserve_internal.authenticated_session_user() is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'themes.read'))
   then return '{"error":"tenant_unavailable"}'; end if;
 select * into t from reserve_internal.themes where id=theme and tenant_id=target and status='ACTIVE';
 if not found then return '{"error":"theme_unavailable"}'; end if;
 select * into r from reserve_internal.theme_revisions where tenant_id=target and theme_id=theme and revision=t.draft_revision;
 if not found then return '{"error":"dependency_unavailable"}'; end if;
 return pg_catalog.jsonb_build_object('theme_id',t.id,'name',t.name,'current_revision',t.draft_revision,
   'tokens',r.tokens,'history',coalesce((select pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('revision',v.revision,'revision_id',v.id,'created_at',v.created_at)
     order by v.revision desc) from (select revision,id,created_at from reserve_internal.theme_revisions
       where tenant_id=target and theme_id=theme order by revision desc limit 50) v),'[]'::jsonb));
end $$;

create function reserve_internal.read_tenant_theme_revision(target uuid,theme uuid,requested integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r reserve_internal.theme_revisions;
begin
 if reserve_internal.authenticated_session_user() is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'themes.read'))
   then return '{"error":"tenant_unavailable"}'; end if;
 if requested is null or requested<1 then return '{"error":"invalid_input"}'; end if;
 select r0.* into r from reserve_internal.theme_revisions r0 join reserve_internal.themes t
   on t.id=r0.theme_id and t.tenant_id=r0.tenant_id
   where r0.tenant_id=target and r0.theme_id=theme and r0.revision=requested and t.status='ACTIVE';
 if not found then return '{"error":"theme_unavailable"}'; end if;
 return pg_catalog.jsonb_build_object('theme_id',r.theme_id,'revision',r.revision,
   'revision_id',r.id,'tokens',r.tokens,'created_at',r.created_at);
end $$;

create function reserve_internal.create_tenant_theme(target uuid,theme_name text,design_tokens jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=reserve_internal.authenticated_session_user(); member uuid;
  safe_name text:=reserve_internal.settings_text(theme_name,80);
  safe_tokens jsonb:=reserve_internal.normalized_theme_tokens(design_tokens);
  theme uuid:=gen_random_uuid(); stamp timestamptz:=pg_catalog.statement_timestamp();
begin
 if actor is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'themes.read')
   and reserve_internal.has_capability(target,'themes.edit')) then return '{"error":"tenant_unavailable"}'; end if;
 if safe_name is null or safe_tokens is null then return '{"error":"invalid_input"}'; end if;
 member:=reserve_internal.current_membership_id(target);
 insert into reserve_internal.themes(id,tenant_id,name,created_by_user_id,created_by_membership_id,created_at,updated_at)
   values(theme,target,safe_name,actor,member,stamp,stamp);
 insert into reserve_internal.theme_revisions(tenant_id,theme_id,revision,tokens,actor_user_id,actor_membership_id,created_at)
   values(target,theme,1,safe_tokens,actor,member,stamp);
 update reserve_internal.themes set draft_revision=1 where id=theme and tenant_id=target;
 insert into reserve_internal.theme_revision_events(tenant_id,theme_id,revision,action,actor_user_id,actor_membership_id,occurred_at)
   values(target,theme,1,'theme.created',actor,member,stamp);
 return reserve_internal.read_tenant_theme(target,theme);
exception when unique_violation then return '{"error":"duplicate_name"}';
  when others then return '{"error":"dependency_unavailable"}';
end $$;

create function reserve_internal.save_tenant_theme_revision(target uuid,theme uuid,expected integer,design_tokens jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=reserve_internal.authenticated_session_user(); member uuid;
  safe_tokens jsonb:=reserve_internal.normalized_theme_tokens(design_tokens);
  next_revision integer; stamp timestamptz:=pg_catalog.statement_timestamp();
begin
 if actor is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'themes.read')
   and reserve_internal.has_capability(target,'themes.edit')) then return '{"error":"tenant_unavailable"}'; end if;
 if expected is null or expected not between 1 and 2147483646 or safe_tokens is null
   then return '{"error":"invalid_input"}'; end if;
 if not exists(select from reserve_internal.themes where id=theme and tenant_id=target and status='ACTIVE')
   then return '{"error":"theme_unavailable"}'; end if;
 member:=reserve_internal.current_membership_id(target);
 update reserve_internal.themes t set draft_revision=t.draft_revision+1,updated_at=stamp
   where t.id=theme and t.tenant_id=target and t.draft_revision=expected
   returning t.draft_revision into next_revision;
 if next_revision is null then return '{"error":"revision_conflict"}'; end if;
 insert into reserve_internal.theme_revisions(tenant_id,theme_id,revision,tokens,source_revision,actor_user_id,actor_membership_id,created_at)
   values(target,theme,next_revision,safe_tokens,expected,actor,member,stamp);
 insert into reserve_internal.theme_revision_events(tenant_id,theme_id,revision,action,actor_user_id,actor_membership_id,occurred_at)
   values(target,theme,next_revision,'theme.revision.saved',actor,member,stamp);
 return reserve_internal.read_tenant_theme(target,theme);
exception when others then return '{"error":"dependency_unavailable"}';
end $$;

-- Publicly discoverable RPC names, but no public data. Every invocation uses
-- genuine live Auth identity and a restricted, RLS-subject executor.
create function public.reserve_list_tenant_themes(target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.list_tenant_themes(target) end
$$;
create function public.reserve_read_tenant_theme(target uuid,theme uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.read_tenant_theme(target,theme) end
$$;
create function public.reserve_read_tenant_theme_revision(target uuid,theme uuid,requested reserve_internal.settings_wire_revision) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.read_tenant_theme_revision(target,theme,(requested #>> '{}')::numeric::integer) end
$$;
create function public.reserve_create_tenant_theme(target uuid,theme_name reserve_internal.settings_wire_text,design_tokens jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.create_tenant_theme(target,theme_name #>> '{}',design_tokens) end
$$;
create function public.reserve_save_tenant_theme_revision(target uuid,theme uuid,expected reserve_internal.settings_wire_revision,design_tokens jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.save_tenant_theme_revision(target,theme,(expected #>> '{}')::numeric::integer,design_tokens) end
$$;

grant create on schema reserve_internal to reserve_theme_executor;
alter function reserve_internal.list_tenant_themes(uuid) owner to reserve_theme_executor;
alter function reserve_internal.read_tenant_theme(uuid,uuid) owner to reserve_theme_executor;
alter function reserve_internal.read_tenant_theme_revision(uuid,uuid,integer) owner to reserve_theme_executor;
alter function reserve_internal.create_tenant_theme(uuid,text,jsonb) owner to reserve_theme_executor;
alter function reserve_internal.save_tenant_theme_revision(uuid,uuid,integer,jsonb) owner to reserve_theme_executor;
revoke create on schema reserve_internal from reserve_theme_executor;
revoke all on function reserve_internal.list_tenant_themes(uuid),reserve_internal.read_tenant_theme(uuid,uuid),
  reserve_internal.read_tenant_theme_revision(uuid,uuid,integer),reserve_internal.create_tenant_theme(uuid,text,jsonb),
  reserve_internal.save_tenant_theme_revision(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_themes(uuid),public.reserve_read_tenant_theme(uuid,uuid),
  public.reserve_read_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision),
  public.reserve_create_tenant_theme(uuid,reserve_internal.settings_wire_text,jsonb),
  public.reserve_save_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function reserve_internal.list_tenant_themes(uuid),reserve_internal.read_tenant_theme(uuid,uuid),
  reserve_internal.read_tenant_theme_revision(uuid,uuid,integer),reserve_internal.create_tenant_theme(uuid,text,jsonb),
  reserve_internal.save_tenant_theme_revision(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_themes(uuid),public.reserve_read_tenant_theme(uuid,uuid),
  public.reserve_read_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision),
  public.reserve_create_tenant_theme(uuid,reserve_internal.settings_wire_text,jsonb),
  public.reserve_save_tenant_theme_revision(uuid,uuid,reserve_internal.settings_wire_revision,jsonb) to authenticated;
revoke reserve_theme_executor from postgres;
comment on table reserve_internal.published_theme_assignments is 'Reserved only: closed RLS and no mutation path until separately reviewed publication slice.';
notify pgrst,'reload schema';
commit;
