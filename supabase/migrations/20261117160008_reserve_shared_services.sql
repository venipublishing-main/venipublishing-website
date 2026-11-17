-- Veni Publishing production migration: reviewed pinned Reserve source (catalogue/preview-m24-service.sql); additively isolated under reserve, reserve_internal and namespaced RPCs.
-- Integration, local real-Auth/RLS testing and owner approval are required.
-- M2.4: tenant-owned Service catalogue, following Location.
-- Candidate for disposable local Supabase only; no hosted release or booking.
begin;

create role reserve_service_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
grant reserve_service_executor to postgres;
grant usage on schema reserve_internal to reserve_service_executor;
grant execute on function reserve_internal.authenticated_session_user(),
  reserve_internal.tenant_access_enabled(uuid),reserve_internal.has_capability(uuid,text),
  reserve_internal.current_membership_id(uuid),reserve_internal.settings_text(text,integer)
  to reserve_service_executor;

-- No arbitrary numeric coercion from JSON strings/decimals; bound before casting.
create function reserve_internal.service_integer(value jsonb,lower_bound integer,upper_bound integer) returns integer
language plpgsql immutable strict security invoker set search_path='' as $$
declare parsed numeric;
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'number' or
     (value #>> '{}') collate "C" !~ '^(0|[1-9][0-9]{0,9})$' then return null; end if;
  parsed:=(value #>> '{}')::numeric;
  if parsed not between lower_bound and upper_bound then return null; end if;
  return parsed::integer;
end $$;
revoke all on function reserve_internal.service_integer(jsonb,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function reserve_internal.service_integer(jsonb,integer,integer) to reserve_service_executor;

-- The Service is an operational offering; eligibility, publication, slots,
-- payments and appointments are separate later milestones.
create table reserve_internal.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references reserve.tenants on update restrict on delete restrict,
  name text not null check(reserve_internal.settings_text(name,120) is not distinct from name),
  description text check(description is null or reserve_internal.settings_text(description,1000) is not distinct from description),
  category text check(category is null or reserve_internal.settings_text(category,80) is not distinct from category),
  duration_minutes integer not null check(duration_minutes between 1 and 10080),
  price_minor_units integer check(price_minor_units between 0 and 2147483647),
  currency_override text check(currency_override is null or currency_override collate "C" ~ '^[A-Z]{3}$'),
  price_display text not null check(price_display in ('AMOUNT','FROM','ON_REQUEST','HIDDEN')),
  buffer_before_minutes integer not null check(buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null check(buffer_after_minutes between 0 and 1440),
  min_notice_minutes integer check(min_notice_minutes between 0 and 525600),
  max_advance_days integer check(max_advance_days between 1 and 3650),
  public_visible boolean not null default false,
  online_bookable boolean not null default false,
  sort_order integer not null default 0 check(sort_order between 0 and 9999),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE','ARCHIVED')),
  revision integer not null check(revision between 1 and 2147483647),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(price_display not in ('AMOUNT','FROM') or price_minor_units is not null),
  unique(tenant_id,id)
);
-- Names can legitimately recur (different categories or similar services);
-- the immutable ID, not a human-readable name, resolves an offering.
create index services_tenant_sort_idx on reserve_internal.services(tenant_id,sort_order,id);
create index services_tenant_category_idx on reserve_internal.services(tenant_id,category,id);

create table reserve_internal.service_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  service_id uuid not null,
  revision integer not null check(revision between 1 and 2147483647),
  action text not null check(action in ('service.created','service.updated','service.archived')),
  actor_user_id uuid not null references reserve.users on update restrict on delete restrict,
  actor_membership_id uuid not null references reserve.memberships on update restrict on delete restrict,
  occurred_at timestamptz not null default now(),
  unique(tenant_id,service_id,revision),
  foreign key(tenant_id,service_id) references reserve_internal.services(tenant_id,id)
    on update restrict on delete restrict,
  check((revision=1 and action='service.created')
     or (revision>1 and action in ('service.updated','service.archived')))
);
create index service_events_tenant_time_idx on reserve_internal.service_events(tenant_id,occurred_at,id);
create trigger service_events_immutable before update or delete or truncate on reserve_internal.service_events
  for each statement execute function reserve_internal.reject_mutation();

alter table reserve_internal.services enable row level security;
alter table reserve_internal.service_events enable row level security;
revoke all on reserve_internal.services,reserve_internal.service_events from public,anon,authenticated,service_role;
grant select,insert on reserve_internal.services to reserve_service_executor;
grant update(name,description,category,duration_minutes,price_minor_units,currency_override,
  price_display,buffer_before_minutes,buffer_after_minutes,min_notice_minutes,max_advance_days,
  public_visible,online_bookable,sort_order,status,revision,updated_at)
  on reserve_internal.services to reserve_service_executor;
grant insert on reserve_internal.service_events to reserve_service_executor;
-- Approved ISO currencies from existing Tenant settings reference catalogue.
grant select on reserve_internal.settings_reference to reserve_service_executor;
create policy settings_catalogue_service_read on reserve_internal.settings_reference for select to reserve_service_executor using(true);
create policy service_read on reserve_internal.services for select to reserve_service_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'services.read'));
create policy service_insert on reserve_internal.services for insert to reserve_service_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'services.manage'));
create policy service_update on reserve_internal.services for update to reserve_service_executor
  using(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'services.manage'))
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'services.manage'));
create policy service_event_insert on reserve_internal.service_events for insert to reserve_service_executor
  with check(reserve_internal.tenant_access_enabled(tenant_id) and reserve_internal.has_capability(tenant_id,'services.manage')
    and actor_user_id=reserve_internal.authenticated_session_user()
    and actor_membership_id=reserve_internal.current_membership_id(tenant_id));

create function reserve_internal.list_tenant_services(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if reserve_internal.authenticated_session_user() is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'services.read'))
   then return '{"error":"tenant_unavailable"}'; end if;
 return pg_catalog.jsonb_build_object('services',coalesce(
   (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'service_id',s.id,'name',s.name,'description',s.description,'category',s.category,
     'duration_minutes',s.duration_minutes,'price_minor_units',s.price_minor_units,
     'currency_override',s.currency_override,'price_display',s.price_display,
     'buffer_before_minutes',s.buffer_before_minutes,'buffer_after_minutes',s.buffer_after_minutes,
     'min_notice_minutes',s.min_notice_minutes,'max_advance_days',s.max_advance_days,
     'public_visible',s.public_visible,'online_bookable',s.online_bookable,
     'sort_order',s.sort_order,'status',s.status,'revision',s.revision)
     order by s.sort_order,s.created_at,s.id)
    from reserve_internal.services s where s.tenant_id=target),'[]'::jsonb));
end $$;

-- Compare-and-swap service edits with an attributed journal row in one atomic
-- operation. Archived identities remain for later Appointment snapshots.
create function reserve_internal.save_tenant_service(target uuid,service uuid,expected integer,attributes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=reserve_internal.authenticated_session_user(); member uuid;
  name_value text; description_value text; category_value text;
  currency_value text; display_value text; state_value text;
  duration_value integer; price_value integer; before_value integer; after_value integer;
  notice_value integer; advance_value integer; order_value integer;
  visible_value boolean; online_value boolean; next_revision integer; new_id uuid;
  stamp timestamptz:=pg_catalog.statement_timestamp();
begin
 if actor is null then return '{"error":"unauthorized"}'; end if;
 if not(reserve_internal.tenant_access_enabled(target) and reserve_internal.has_capability(target,'services.manage')
   and reserve_internal.has_capability(target,'services.read')) then return '{"error":"tenant_unavailable"}'; end if;
 if expected is null or expected not between 0 and 2147483646 or
   (expected=0 and service is not null) or (expected>0 and service is null) or
   pg_catalog.jsonb_typeof(attributes) is distinct from 'object'
 then return '{"error":"invalid_input"}'; end if;
 if
   (select count(*) from pg_catalog.jsonb_object_keys(attributes))<>15 or
   not(attributes ?& array['name','description','category','duration_minutes','price_minor_units',
     'currency_override','price_display','buffer_before_minutes','buffer_after_minutes',
     'min_notice_minutes','max_advance_days','public_visible','online_bookable','sort_order','status'])
 then return '{"error":"invalid_input"}'; end if;
 if pg_catalog.jsonb_typeof(attributes->'name') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'price_display') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'status') is distinct from 'string' or
   pg_catalog.jsonb_typeof(attributes->'public_visible') is distinct from 'boolean' or
   pg_catalog.jsonb_typeof(attributes->'online_bookable') is distinct from 'boolean' or
   (attributes->'description'<>'null'::jsonb and pg_catalog.jsonb_typeof(attributes->'description') is distinct from 'string') or
   (attributes->'category'<>'null'::jsonb and pg_catalog.jsonb_typeof(attributes->'category') is distinct from 'string') or
   (attributes->'currency_override'<>'null'::jsonb and pg_catalog.jsonb_typeof(attributes->'currency_override') is distinct from 'string')
 then return '{"error":"invalid_input"}'; end if;
 name_value:=reserve_internal.settings_text(attributes->>'name',120);
 description_value:=case when attributes->'description'='null'::jsonb then null
   else reserve_internal.settings_text(attributes->>'description',1000) end;
 category_value:=case when attributes->'category'='null'::jsonb then null
   else reserve_internal.settings_text(attributes->>'category',80) end;
 currency_value:=case when attributes->'currency_override'='null'::jsonb then null
   else attributes->>'currency_override' end;
 display_value:=attributes->>'price_display';state_value:=attributes->>'status';
 visible_value:=(attributes->>'public_visible')::boolean;
 online_value:=(attributes->>'online_bookable')::boolean;
 duration_value:=reserve_internal.service_integer(attributes->'duration_minutes',1,10080);
 price_value:=reserve_internal.service_integer(attributes->'price_minor_units',0,2147483647);
 before_value:=reserve_internal.service_integer(attributes->'buffer_before_minutes',0,1440);
 after_value:=reserve_internal.service_integer(attributes->'buffer_after_minutes',0,1440);
 notice_value:=reserve_internal.service_integer(attributes->'min_notice_minutes',0,525600);
 advance_value:=reserve_internal.service_integer(attributes->'max_advance_days',1,3650);
 order_value:=reserve_internal.service_integer(attributes->'sort_order',0,9999);
 if name_value is null or
   (attributes->'description'<>'null'::jsonb and description_value is null) or
   (attributes->'category'<>'null'::jsonb and category_value is null) or
   duration_value is null or before_value is null or after_value is null or order_value is null or
   (attributes->'price_minor_units'<>'null'::jsonb and price_value is null) or
   (attributes->'min_notice_minutes'<>'null'::jsonb and notice_value is null) or
   (attributes->'max_advance_days'<>'null'::jsonb and advance_value is null) or
   (currency_value is not null and (currency_value collate "C" !~ '^[A-Z]{3}$' or
     not exists(select from reserve_internal.settings_reference where kind='currency' and code=currency_value))) or
   display_value not in ('AMOUNT','FROM','ON_REQUEST','HIDDEN') or
   (display_value in ('AMOUNT','FROM') and price_value is null) or
   state_value not in ('ACTIVE','INACTIVE','ARCHIVED') or
   (expected=0 and state_value='ARCHIVED')
 then return '{"error":"invalid_input"}'; end if;
 member:=reserve_internal.current_membership_id(target);
 if expected=0 then
   new_id:=gen_random_uuid();
   insert into reserve_internal.services(id,tenant_id,name,description,category,duration_minutes,
     price_minor_units,currency_override,price_display,buffer_before_minutes,buffer_after_minutes,
     min_notice_minutes,max_advance_days,public_visible,online_bookable,sort_order,status,
     revision,created_at,updated_at)
   values(new_id,target,name_value,description_value,category_value,duration_value,
     price_value,currency_value,display_value,before_value,after_value,
     notice_value,advance_value,visible_value,online_value,order_value,state_value,1,stamp,stamp);
   next_revision:=1;
 else
   if not exists(select from reserve_internal.services s where s.id=service and s.tenant_id=target
     and s.status<>'ARCHIVED') then return '{"error":"service_unavailable"}'; end if;
   update reserve_internal.services s set name=name_value,description=description_value,category=category_value,
     duration_minutes=duration_value,price_minor_units=price_value,currency_override=currency_value,
     price_display=display_value,buffer_before_minutes=before_value,buffer_after_minutes=after_value,
     min_notice_minutes=notice_value,max_advance_days=advance_value,public_visible=visible_value,
     online_bookable=online_value,sort_order=order_value,status=state_value,
     revision=s.revision+1,updated_at=stamp
   where s.id=service and s.tenant_id=target and s.revision=expected and s.status<>'ARCHIVED'
   returning s.revision into next_revision;
   if next_revision is null then return '{"error":"revision_conflict"}'; end if;
   new_id:=service;
 end if;
 insert into reserve_internal.service_events(tenant_id,service_id,revision,action,
   actor_user_id,actor_membership_id,occurred_at)
 values(target,new_id,next_revision,case when next_revision=1 then 'service.created'
   when state_value='ARCHIVED' then 'service.archived' else 'service.updated' end,actor,member,stamp);
 return pg_catalog.jsonb_build_object('service_id',new_id,'revision',next_revision,
   'services',(reserve_internal.list_tenant_services(target)->'services'));
exception when others then return '{"error":"dependency_unavailable"}';
end $$;

-- No public Service table and no anonymous read. These are authenticated
-- invoker wrappers with private restricted-RLS implementation routines.
create function public.reserve_list_tenant_services(target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.list_tenant_services(target) end
$$;
create function public.reserve_save_tenant_service(target uuid,service uuid,
  expected reserve_internal.settings_wire_revision,attributes jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select case when reserve_internal.authenticated_session_user() is null then '{"error":"unauthorized"}'::jsonb
 else reserve_internal.save_tenant_service(target,service,(expected #>> '{}')::numeric::integer,attributes) end
$$;
grant create on schema reserve_internal to reserve_service_executor;
alter function reserve_internal.list_tenant_services(uuid) owner to reserve_service_executor;
alter function reserve_internal.save_tenant_service(uuid,uuid,integer,jsonb) owner to reserve_service_executor;
revoke create on schema reserve_internal from reserve_service_executor;
revoke all on function reserve_internal.list_tenant_services(uuid),reserve_internal.save_tenant_service(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_services(uuid),
  public.reserve_save_tenant_service(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function reserve_internal.list_tenant_services(uuid),reserve_internal.save_tenant_service(uuid,uuid,integer,jsonb),
  public.reserve_list_tenant_services(uuid),
  public.reserve_save_tenant_service(uuid,uuid,reserve_internal.settings_wire_revision,jsonb)
  to authenticated;
revoke reserve_service_executor from postgres;
comment on table reserve_internal.services is 'M2 Service catalogue; tenant-private and unpublished until later eligibility and booking gates.';
notify pgrst,'reload schema';
commit;
