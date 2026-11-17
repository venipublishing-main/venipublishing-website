import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_M2, transformM2 } from '../scripts/merge-reserve-m2.mjs';

const fixture = `-- M2.1 test fixture
begin;
create role veni_settings_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;
grant usage on schema private to veni_settings_executor;
create function private.settings_actor() returns uuid language sql as $$ select null::uuid $$;
create table private.settings_reference (id int);
create table private.tenant_business_settings (tenant_id uuid references public.tenants);
create table private.tenant_business_settings_changes (actor uuid references public.users);
create function public.read_tenant_business_settings(target uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.save_tenant_business_settings(target uuid,expected_revision private.settings_wire_revision,
  display_name private.settings_wire_text) returns jsonb language sql as $$ select '{}'::jsonb $$;
select public.read_tenant_business_settings(null);
select * from public.memberships;
revoke veni_settings_executor from postgres;
commit;
`;

test('pins the next merged Reserve main migration, not speculative PR work', () => {
  assert.equal(SOURCE_M2.filename, '20261103160923_tenant_business_settings.sql');
  assert.match(SOURCE_M2.blob, /^[0-9a-f]{40}$/);
});

test('isolates settings tables, helper functions, role and public RPC names', () => {
  const sql = transformM2(fixture);
  assert.match(sql, /create role reserve_settings_executor nologin nosuperuser nobypassrls/);
  assert.match(sql, /grant usage on schema reserve_internal to reserve_settings_executor/);
  assert.match(sql, /create table reserve_internal\.tenant_business_settings /);
  assert.match(sql, /references reserve\.tenants/);
  assert.match(sql, /references reserve\.users/);
  assert.match(sql, /from reserve\.memberships/);
  assert.match(sql, /create function public\.reserve_read_tenant_business_settings/);
  assert.match(sql, /create function public\.reserve_save_tenant_business_settings/);
  assert.match(sql, /expected_revision reserve_internal\.settings_wire_revision/);
  assert.doesNotMatch(sql, /\bveni_settings_executor\b|\bprivate\./);
});

test('refuses new website public dependencies', () => {
  assert.throws(() => transformM2(fixture.replace('public.memberships', 'public.profiles')),
    /Unexpected M2\.1 public dependency/);
});

test('fails closed when critical role or bounded RPC definition changes', () => {
  assert.throws(() => transformM2(fixture.replace('nobypassrls', 'bypassrls')),
    /expected exactly one critical source marker/);
  assert.throws(() => transformM2(fixture.replace('create function public.read_tenant_business_settings',
    'create function public.unbounded_read')),
    /Unexpected M2\.1 public dependency/);
});
