import assert from 'node:assert/strict';
import test from 'node:test';
import { gitBlobSha, SOURCES, transformM1 } from '../scripts/merge-reserve-m1.mjs';

test('pins exactly the three hosted Reserve M1 migration sources', () => {
  assert.deepEqual(SOURCES.map(x => x.id), ['m1a', 'm1b', 'm12']);
  assert.ok(SOURCES.every(x => /^[0-9a-f]{40}$/.test(x.blob)));
  assert.equal(gitBlobSha('test\n'), '9daeafb9864cf43055ae93beb0afd6c7d144bfa4');
});

test('retargets Reserve tenant, member and auth projection without touching auth.users', () => {
  const source = `create table public.tenants (id uuid);\n` +
    `create table public.users (id uuid references auth.users(id));\n` +
    `create table public.memberships (tenant_id uuid references public.tenants);\n` +
    `revoke all on public.users from public, anon, authenticated;\n`;
  const result = transformM1('m1a', source);
  assert.match(result, /create schema if not exists reserve;/);
  assert.match(result, /create table reserve\.users \(id uuid references auth\.users\(id\)\)/);
  assert.match(result, /references reserve\.tenants/);
  assert.match(result, /from public, anon, authenticated/); // PUBLIC is a role, not a schema.
  assert.doesNotMatch(result, /\bpublic\.users\b/);
});

test('separates M1.1b internal functions and private invitation tables', () => {
  const source = `create schema if not exists private;\n` +
    `revoke all on schema private from public, anon, authenticated;\n` +
    `create table private.invitations (tenant_id uuid references public.tenants);\n` +
    `create function private.audit_guard() returns trigger language plpgsql as $$ begin return new; end $$;`;
  const result = transformM1('m1b', source);
  assert.match(result, /create schema if not exists reserve_internal;/);
  assert.match(result, /create table reserve_internal\.invitations/);
  assert.match(result, /references reserve\.tenants/);
  assert.match(result, /create function reserve_internal\.audit_guard\(\)/);
  assert.doesNotMatch(result, /\bschema private\b/);
});

test('M1.2 must never revoke privileges from the website public schema', () => {
  const source = `begin;\n` +
    `select 1 from pg_catalog.pg_tables where schemaname in ('public', 'private');\n` +
    `revoke create on schema public from public, anon, authenticated, service_role;\n` +
    `select 1 where n.nspname = 'public' or n.nspname = 'private';\n` +
    `create policy tenant_read on public.tenants using (private.tenant_access_enabled(id));\n` +
    `commit;`;
  const result = transformM1('m12', source);
  assert.match(result, /revoke create on schema reserve from public, anon/);
  assert.doesNotMatch(result, /revoke create on schema public/);
  assert.match(result, /schemaname in \('reserve', 'reserve_internal'\)/);
  assert.match(result, /n\.nspname = 'reserve_internal'/);
  assert.match(result, /grant usage on schema reserve to authenticated;/);
});

test('new public dependencies fail closed until explicitly reviewed', () => {
  assert.throws(() => transformM1('m1a', 'select * from public.profiles;'), /Unexpected source public reference/);
  assert.throws(() => transformM1('other', 'select 1'), /Unknown M1 step/);
});

test('drift in high-impact security source markers fails closed', () => {
  assert.throws(() => transformM1('m12', 'create policy x on public.users for select;'), /expected exactly one source marker/);
  assert.throws(() => transformM1('m1b', 'create table private.invitations(id uuid);'), /expected exactly one source marker/);
});
