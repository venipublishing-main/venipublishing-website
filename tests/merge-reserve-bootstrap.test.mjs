import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_BOOTSTRAP, transformBootstrap } from '../scripts/merge-reserve-bootstrap.mjs';

// Intentionally minimal synthetic text. The CLI separately pins and verifies
// the complete immutable Reserve SQL blob before emitting its local preview.
const fixture = `-- synthetic M2.2 candidate
begin;
create function private.authenticated_session_user() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_reserve_user() returns uuid language sql as $$select private.authenticated_session_user()$$;
create role veni_bootstrap_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
grant usage on schema private,public to veni_bootstrap_executor;
create table private.tenant_bootstrap_requests (user_id uuid references public.users,tenant_id uuid references public.tenants,membership_id uuid references public.memberships);
create policy bootstrap_receipts on private.tenant_bootstrap_requests for all to veni_bootstrap_executor using(true);
create function private.bootstrap_setup_tenant(request_key uuid) returns jsonb language plpgsql as $$
begin
 if current_setting('transaction_isolation')<>'serializable' then raise exception 'denied'; end if;
 insert into public.membership_roles select * from public.roles;
 insert into public.audit_events select * from public.audit_events;
 return '{}'::jsonb;
end $$;
alter function private.bootstrap_setup_tenant(uuid) owner to veni_bootstrap_executor;
create function public.bootstrap_setup_tenant(request_key uuid) returns jsonb language sql
 set default_transaction_isolation='serializable' as $$ select private.bootstrap_setup_tenant(request_key) $$;
create or replace function public.read_tenant_business_settings(target uuid) returns jsonb
 language sql as $$ select '{}'::jsonb $$;
create or replace function public.save_tenant_business_settings(target uuid,expected_revision private.settings_wire_revision,
 display_name private.settings_wire_text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.list_setup_tenants() returns jsonb language sql as $$
 select public.read_tenant_business_settings(null) from public.tenants $$;
revoke veni_bootstrap_executor from postgres;
notify pgrst,'reload schema';
commit;
`;

test('bootstrap preview is pinned to the expected Reserve source migration', () => {
  assert.equal(SOURCE_BOOTSTRAP.filename, '20261113111616_tenant_bootstrap.sql');
  assert.equal(SOURCE_BOOTSTRAP.blob, '1660931b47eb5415eaa1bd64d284ea499b461479');
});

test('isolates bootstrap receipt, all business relations, RPC entry points, and executor role', () => {
  const converted = transformBootstrap(fixture);
  for (const expected of [
    'create function reserve_internal.authenticated_session_user()',
    'create function public.reserve_current_reserve_user()',
    'create role reserve_bootstrap_executor nologin nosuperuser nobypassrls',
    'grant usage on schema reserve_internal,reserve to reserve_bootstrap_executor;',
    'create table reserve_internal.tenant_bootstrap_requests',
    'references reserve.users', 'references reserve.tenants', 'references reserve.memberships',
    'insert into reserve.membership_roles', 'insert into reserve.audit_events',
    'create function public.reserve_bootstrap_setup_tenant',
    'create or replace function public.reserve_read_tenant_business_settings',
    'create or replace function public.reserve_save_tenant_business_settings',
    'create function public.reserve_list_setup_tenants',
  ]) assert.ok(converted.includes(expected), `Missing isolated marker: ${expected}`);
  assert.doesNotMatch(converted, /\bprivate\.|\bveni_bootstrap_executor\b|\bpublic\.tenants\b/);
});

test('refuses unreviewed Website or Arcana dependencies', () => {
  assert.throws(() => transformBootstrap(fixture.replace('public.tenants', 'public.profiles')),
    /Unexpected source M2\.2 public reference/);
  assert.throws(() => transformBootstrap(fixture.replace('public.audit_events', 'public.arcana_readings')),
    /Unexpected source M2\.2 public reference/);
  assert.throws(() => transformBootstrap(fixture.replace('create table private.tenant_bootstrap_requests',
    'create table public.unexpected_table')),
    /Unexpected source M2\.2 public reference|source marker missing/);
});

test('refuses privilege changes, missing serializable requirement and unsafe schema grants', () => {
  assert.throws(() => transformBootstrap(fixture.replace('nobypassrls', 'bypassrls')),
    /source marker missing/);
  assert.throws(() => transformBootstrap(fixture.replace("current_setting('transaction_isolation')<>'serializable'",
    "current_setting('transaction_isolation')<>'read committed'")), /source marker missing/);
  assert.throws(() => transformBootstrap(fixture.replace('grant usage on schema private,public',
    'grant usage on schema public')), /source marker missing|shared public/);
  assert.throws(() => transformBootstrap(fixture.replace('commit;', 'rollback;')),
    /transaction boundary changed/);
});

test('refuses ambiguous duplicated security-critical function definitions', () => {
  assert.throws(() => transformBootstrap(fixture.replace('commit;',
    'create function public.list_setup_tenants() returns jsonb;\ncommit;')),
    /source marker missing\/duplicated/);
});
