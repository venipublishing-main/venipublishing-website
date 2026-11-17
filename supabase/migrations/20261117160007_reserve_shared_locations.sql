-- Veni Publishing production migration: reviewed pinned Reserve source (catalogue/preview-m23-location.sql); additively isolated under reserve, reserve_internal and namespaced RPCs.
-- Integration, local real-Auth/RLS testing and owner approval are required.
-- M2.3: first persistent business-graph node (Location).
-- Candidate for disposable local Supabase only; never apply to hosted projects
-- before the separately approved shared-account/cutover release gate.
begin;

create role reserve_location_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
grant reserve_location_executor to postgres;
grant usage on schema reserve_internal to reserve_location_executor;
grant execute on function reserve_internal.authenticated_session_user(),
  reserve_internal.tenant_access_enabled(uuid),reserve_internal.has_capability(uuid,text),
  reserve_internal.current_membership_id(uuid),reserve_internal.settings_text(text,integer)
  to reserve_location_executor;

-- Business Locations are delivery contexts, not independent login accounts.
-- Even a single-site business stores one Location; no VVB-specific columns.
create table reserve_internal.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references reserve.tenants on update restrict on delete restrict,
  name text not null check(reserve_internal.settings_text(name,120) is not distinct from name),
  kind text not null check(kind in ('PHYSICAL','VIRTUAL','MOBILE','OTHER')),
  description text check(description is null or reserve_internal.settings_text(description,500) is not distinct from description),
  timezone_override text check(timezone_override is null or
    (pg_catalog.char_length(timezone_override) between 1 and 100 and
     timezone_override collate "C" ~ '^[A-Za-z0-9_+/-]+$')),
  public_visible boolean not null default false,
  sort_order integer not null default 0 check(sort_order between 0 and 9999),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE','ARCHIVED')),
  revision integer not null check(revision between 1 and 2147483647),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create unique index location_live_name_idx on reserve_internal.locations(tenant_id,pg_catalog.lower(name collate "C"))
  where status<>'ARCHIVED';
create index locations_tenant_sort_idx on reserve_internal.locations(tenant_id,sort_order,id);

create table reserve_internal.location_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  revision integer not null check(revision between 1 and 2147483647),
  action text not null check(action in ('location.created','location.updated','location.archived')),
  actor_user_id uuid not null references reserve.users on update restrict on delete restrict,
  actor_membership_id uuid not null references reserve.memberships on update restrict on delete restrict,
  occurred_at timestamptz not null default now(),
  unique(tenant_id,location_id,revision),
  foreign key(tenant_id,location_id) references reserve_internal.locations(tenant_id,id)
    on update restrict on delete restrict,
  check((revision=1 and action='location.created')
     or (revision>1 and action in ('location.updated','location.archived')))
);
create index location_events_tenant_time_idx on reserve_internal.location_events(tenant_id,occurred_at,id);
create trigger location_events_immutable before update or delete or truncate on reserve_internal.location_events
  for each statement execute function reserve_internal.reject_mutation();

alter table reserve_internal.locations enable row level security;
alter table reserve_internal.location_events enable row level security;
revoke all on reserve_internal.locations,reserve_internal.location_events from public,anon,authenticated,service_role;
grant select,insert on reserve_internal.locations to reserve_location_executor;
grant update(name,kind,description,timezone_override,public_visible,sort_order,status,revision,updated_at)
  on reserve_internal.locations to reserve_location_executor;
grant insert on reserve_internal.location_events to reserve_location_executor;
create policy location_read on reserve_internal.locations for select to reserve_location_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'tenant.read'));
create policy location_insert on reserve_internal.locations for insert to reserve_location_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'tenant.settings_manage'));
create policy location_update on reserve_internal.locations for update to reserve_location_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'tenant.settings_manage'))
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'tenant.settings_manage'));
create policy location_event_insert on reserve_internal.location_events for insert to reserve_location_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'tenant.settings_manage')
    and actor_user_id=reserve_internal.authenticated_session_user()
    and actor_membership_id=reserve_internal.current_membership_id(tenant_id));

create function reserve_internal.list_tenant_locations(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if reserve_internal.authenticated_session_user() is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'tenant.read'))
   then return '{"error":"tenant_unavailable"}'; end if;
 return pg_catalog.jsonb_build_object('locations',coalesce(
   (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'location_id',l.id,'name',l.name,'kind',l.kind,'description',l.description,
     'timezone_override',l.timezone_override,'public_visible',l.public_visible,
     'sort_order',l.sort_order,'status',l.status,'revision',l.revision)
     order by l.sort_order,l.created_at,l.id)
    from reserve_internal.locations l where l.tenant_id=target),'[]'::jsonb));
end $$;

-- One compare-and-swap endpoint creates/edits/archives a Location with an
-- attributed journal row in the same transaction. No DELETE operation exists.
create function reserve_internal.save_tenant_location(target uuid,location uuid,expected integer,attributes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=reserve_internal.authenticated_session_user(); member uuid;
  name_value text; description_value text; zone text; kind_value text; state_value text;
  visible_value boolean; order_value integer; next_revision integer; new_id uuid;
  stamp timestamptz:=pg_catalog.statement_timestamp();
begin
 if actor is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'tenant.settings_manage')
   and reserve_internal.has_capability(target,'tenant.read')) then return '{"error":"tenant_unavailable"}'; end if;
 if expected is null or expected not between 0 and 2147483646 or
   (expected=0 and location is not null) or (expected>0 and location is null) or
   pg_catalog.jsonb_typeof(attributes) is distinct from 'object' or
   (select count(*) from pg_catalog.jsonb_object_keys(attributes))<>7 or
   not (attributes ?& array['name','kind','description','timezone_override','public_visible','sort_order','status'])
 then return '{"error":"invalid_input"}'; end if;
 if pg_catalog.jsonb_typeof(attributes->'name') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'kind') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'status') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'public_visible') is distinct from 'boolean' or
   pg_catalog.jsonb_typeof(attributes->'sort_order') is distinct from 'number' or
   (attributes->>'sort_order') collate "C" !~ '^(0|[1-9][0-9]{0,3})$' or
   (attributes->'description'<>'null'::jsonb and pg_catalog.jsonb_typeof(attributes->'description') is distinct from 'string') or
   (attributes->'timezone_override'<>'null'::jsonb and pg_catalog.jsonb_typeof(attributes->'timezone_override') is distinct from 'string')
 then return '{"error":"invalid_input"}'; end if;
 name_value:=reserve_internal.settings_text(attributes->>'name',120);
 description_value:=case when attributes->'description'='null'::jsonb then null
   else reserve_internal.settings_text(attributes->>'description',500) end;
 zone:=case when attributes->'timezone_override'='null'::jsonb then null
   else attributes->>'timezone_override' end;
 kind_value:=attributes->>'kind'; state_value:=attributes->>'status';
 visible_value:=(attributes->>'public_visible')::boolean;
 order_value:=(attributes->>'sort_order')::integer;
 if name_value is null or (attributes->'description'<>'null'::jsonb and description_value is null)
   or kind_value not in ('PHYSICAL','VIRTUAL','MOBILE','OTHER')
   or state_value not in ('ACTIVE','INACTIVE','ARCHIVED')
   or (expected=0 and state_value='ARCHIVED')
   or (zone is not null and not exists(select from pg_catalog.pg_timezone_names where name=zone))
 then return '{"error":"invalid_input"}'; end if;
 member:=reserve_internal.current_membership_id(target);
 if expected=0 then
   new_id:=gen_random_uuid();
   insert into reserve_internal.locations(id,tenant_id,name,kind,description,timezone_override,
     public_visible,sort_order,status,revision,created_at,updated_at)
   values(new_id,target,name_value,kind_value,description_value,zone,
     visible_value,order_value,state_value,1,stamp,stamp);
   next_revision:=1;
 else
   if not exists(select from reserve_internal.locations l where l.id=location and l.tenant_id=target
     and l.status<>'ARCHIVED') then return '{"error":"location_unavailable"}'; end if;
   update reserve_internal.locations l set name=name_value,kind=kind_value,description=description_value,
     timezone_override=zone,public_visible=visible_value,sort_order=order_value,
     status=state_value,revision=l.revision+1,updated_at=stamp
   where l.id=location and l.tenant_id=target and l.revision=expected and l.status<>'ARCHIVED'
   returning l.revision into next_revision;
   if next_revision is null then return '{"error":"revision_conflict"}'; end if;
   new_id:=location;
 end if;
 insert into reserve_internal.location_events(tenant_id,location_id,revision,action,
   actor_user_id,actor_membership_id,occurred_at)
 values(target,new_id,next_revision,case when next_revision=1 then 'location.created'
   when state_value='ARCHIVED' then 'location.archived' else 'location.updated' end,actor,member,stamp);
 return pg_catalog.jsonb_build_object('location_id',new_id,'revision',next_revision,
   'locations',(reserve_internal.list_tenant_locations(target)->'locations'));
exception when unique_violation then return '{"error":"duplicate_name"}';
  when others then return '{"error":"dependency_unavailable"}';
end $$;

-- Public schema contains only invoker RPC wrappers; relations remain reserve_internal.
create function public.reserve_list_tenant_locations(target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.list_tenant_locations(target) end
$$;
create function public.reserve_save_tenant_location(target uuid,location uuid,
  expected reserve_internal.settings_wire_revision,attributes jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.save_tenant_location(target,location,(expected #>> '{}')::numeric::integer,attributes) end
$$;
grant create on schema reserve_internal to reserve_location_executor;
alter function reserve_internal.list_tenant_locations(uuid) owner to reserve_location_executor;
alter function reserve_internal.save_tenant_location(uuid,uuid,integer,jsonb) owner to reserve_location_executor;
revoke create on schema reserve_internal from reserve_location_executor;
revoke all on function reserve_internal.list_tenant_locations(uuid),reserve_internal.save_tenant_location(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_locations(uuid),
  public.reserve_save_tenant_location(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function reserve_internal.list_tenant_locations(uuid),reserve_internal.save_tenant_location(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_locations(uuid),
  public.reserve_save_tenant_location(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)
  to authenticated;
revoke reserve_location_executor from postgres;
comment on table reserve_internal.locations is 'M2 business Location; private, tenant-owned; no public projection or booking availability in this slice.';
notify pgrst,'reload schema';
commit;
