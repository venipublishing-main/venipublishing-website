-- Run ONLY on a disposable local Reserve SOURCE after FIVE real GoTrue signups.
-- psql -v binds five validated synthetic UUIDs; this file NEVER creates Auth.
\set ON_ERROR_STOP on

begin transaction isolation level serializable;
insert into public.users(id) values
  (:'owner_a'::uuid), (:'owner_b'::uuid), (:'assistant'::uuid),
  (:'staff'::uuid), (:'unassigned'::uuid);

insert into public.tenants(id,status) values
  ('c1111111-1111-4111-8111-111111111111','ACTIVE'),
  ('c2222222-2222-4222-8222-222222222222','SETUP');

insert into public.roles(id,kind,tenant_id,code,display_name) values
  ('50000000-0000-4000-8000-000000000001','CUSTOM',
   'c1111111-1111-4111-8111-111111111111','assistant','Assistant');
insert into public.role_permissions(role_id,permission_code) values
  ('50000000-0000-4000-8000-000000000001','tenant.read'),
  ('50000000-0000-4000-8000-000000000001','members.read');

insert into public.memberships(id,tenant_id,user_id,status) values
  ('e1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111',:'owner_a'::uuid,'ACTIVE'),
  ('e2222222-2222-4222-8222-222222222222','c2222222-2222-4222-8222-222222222222',:'owner_b'::uuid,'ACTIVE'),
  ('e3333333-3333-4333-8333-333333333333','c1111111-1111-4111-8111-111111111111',:'assistant'::uuid,'ACTIVE'),
  ('e4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222',:'staff'::uuid,'ACTIVE');
insert into public.membership_roles(membership_id,role_id) values
  ('e1111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001'),
  ('e2222222-2222-4222-8222-222222222222','10000000-0000-4000-8000-000000000001'),
  ('e3333333-3333-4333-8333-333333333333','50000000-0000-4000-8000-000000000001'),
  ('e4444444-4444-4444-8444-444444444444','10000000-0000-4000-8000-000000000004');

with issued as (select now() as issued_at)
insert into private.invitations
  (id,tenant_id,target_email,inviter_user_id,inviter_membership_id,
   created_at,expires_at,request_key,request_fingerprint,token_verifier)
select
  'f1111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'future-person@example.invalid', :'owner_a'::uuid,
  'e1111111-1111-4111-8111-111111111111',
  issued_at, issued_at + interval '168 hours',
  'f2222222-2222-4222-8222-222222222222',
  decode(repeat('12',32),'hex'), decode(repeat('34',32),'hex')
from issued;
insert into private.invitation_roles(invitation_id,role_id) values
  ('f1111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000004');

insert into public.audit_events
  (id,tenant_id,action,actor_type,service_actor,reason_code,target_type,target_id,correlation_id)
values
  ('a1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111',
   'membership.activated','SERVICE','trusted_bootstrap','BOOTSTRAP','membership',
   'e1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333'),
  ('a2222222-2222-4222-8222-222222222222','c2222222-2222-4222-8222-222222222222',
   'ownership.granted','SERVICE','trusted_bootstrap','BOOTSTRAP','membership',
   'e2222222-2222-4222-8222-222222222222','a4444444-4444-4444-8444-444444444444');
commit;

select 'PASS: real-GoTrue Reserve source has two synthetic tenant graphs and audit history' as result;
