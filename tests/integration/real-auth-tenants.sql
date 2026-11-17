-- Runs only against the disposable local Supabase stack after three genuine
-- GoTrue sign-ups. psql -v passes validated UUID strings, never user input.
\set ON_ERROR_STOP on

begin transaction isolation level serializable;

insert into reserve.users (id) values
  (:'owner_a'::uuid),
  (:'owner_b'::uuid);

insert into reserve.tenants (id, status) values
  ('11111111-1111-4111-8111-111111111111', 'SETUP'),
  ('22222222-2222-4222-8222-222222222222', 'SETUP');

insert into reserve.memberships (id, tenant_id, user_id, status) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', :'owner_a'::uuid, 'ACTIVE'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', :'owner_b'::uuid, 'ACTIVE');

insert into reserve.membership_roles (membership_id, role_id) values
  ('33333333-3333-4333-8333-333333333333', '10000000-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444', '10000000-0000-4000-8000-000000000001');

commit;

-- Auth must be real, not the earlier mock. All three users have actual
-- sessions, and the website account trigger created the matching profiles.
select 1 / (case when (select count(*) from auth.sessions where user_id in
  (:'owner_a'::uuid, :'owner_b'::uuid, :'outsider'::uuid)) >= 3 then 1 else 0 end)
  as verified_real_auth_sessions;

select 1 / (case when (select count(*) from public.profiles where id in
  (:'owner_a'::uuid, :'owner_b'::uuid, :'outsider'::uuid)) = 3 then 1 else 0 end)
  as verified_website_profiles;

select 1 / (case when (select count(*) from reserve.users) = 2 then 1 else 0 end)
  as verified_no_shadow_user_for_outsider;
