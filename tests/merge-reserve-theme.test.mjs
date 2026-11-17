import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_THEME, transformTheme } from '../scripts/merge-reserve-theme.mjs';

const markers = [
  'create role veni_theme_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;',
  'grant usage on schema private to veni_theme_executor;',
  'create function private.normalized_theme_tokens(value jsonb) returns jsonb;',
  'create table private.themes (tenant_id uuid references public.tenants,created_by_user_id uuid references public.users);',
  'create table private.theme_revisions (actor_membership_id uuid references public.memberships);',
  'create table private.theme_revision_events (theme_id uuid);',
  'create table private.published_theme_assignments (tenant_id uuid);',
  'alter table private.published_theme_assignments enable row level security;',
  'create trigger theme_revisions_immutable before update or delete or truncate on private.theme_revisions;',
  'create trigger theme_revision_events_immutable before update or delete or truncate on private.theme_revision_events;',
  'create policy theme_create on private.themes;',
  'create policy theme_revision_append on private.theme_revisions;',
  'create policy theme_event_append on private.theme_revision_events;',
  'create function private.list_tenant_themes(target uuid) returns jsonb;',
  'create function private.read_tenant_theme(target uuid,theme uuid) returns jsonb;',
  'create function private.read_tenant_theme_revision(target uuid,theme uuid,requested integer) returns jsonb;',
  'create function private.create_tenant_theme(target uuid,theme_name text,design_tokens jsonb) returns jsonb;',
  'create function private.save_tenant_theme_revision(target uuid,theme uuid,expected integer,design_tokens jsonb) returns jsonb;',
  'create function public.list_tenant_themes(target uuid) returns jsonb;',
  'create function public.read_tenant_theme(target uuid,theme uuid) returns jsonb;',
  'create function public.read_tenant_theme_revision(target uuid,theme uuid,requested private.settings_wire_revision) returns jsonb;',
  'create function public.create_tenant_theme(target uuid,theme_name private.settings_wire_text,design_tokens jsonb) returns jsonb;',
  'create function public.save_tenant_theme_revision(target uuid,theme uuid,expected private.settings_wire_revision,design_tokens jsonb) returns jsonb;',
  'grant create on schema private to veni_theme_executor;',
  'revoke create on schema private from veni_theme_executor;',
  'revoke veni_theme_executor from postgres;',
  "notify pgrst,'reload schema';",
];
const fixture = `-- synthetic M7 candidate\n-- all records are private\nbegin;\n${markers.join('\n')}\ncommit;\n`;

test('M7 exact draft SQL source is immutable and pinned', () => {
  assert.equal(SOURCE_THEME.filename, '20261114110626_theme_revisions_private_drafts.sql');
  assert.equal(SOURCE_THEME.blob, '457669782a5dcb00f3c851f89c9f3cd7fa0b959f');
});
test('Theme entities, private revisions, RPCs and RLS executor stay Reserve-namespaced', () => {
  const sql = transformTheme(fixture);
  for (const marker of [
    'create role reserve_theme_executor nologin nosuperuser nobypassrls',
    'grant usage on schema reserve_internal to reserve_theme_executor',
    'create function reserve_internal.normalized_theme_tokens',
    'create table reserve_internal.themes',
    'create table reserve_internal.theme_revisions',
    'create table reserve_internal.theme_revision_events',
    'create table reserve_internal.published_theme_assignments',
    'references reserve.users', 'references reserve.tenants', 'references reserve.memberships',
    'create function public.reserve_list_tenant_themes',
    'create function public.reserve_read_tenant_theme',
    'create function public.reserve_read_tenant_theme_revision',
    'create function public.reserve_create_tenant_theme',
    'create function public.reserve_save_tenant_theme_revision',
    'create trigger theme_revisions_immutable',
    'create trigger theme_revision_events_immutable',
    'revoke reserve_theme_executor from postgres',
  ]) assert.ok(sql.includes(marker), `Missing isolated marker ${marker}`);
  assert.doesNotMatch(sql, /\bprivate\.|\bveni_theme_executor\b|\bpublic\.tenants\b/);
});
test('unreviewed Website/Arcana tables and open publish commands are rejected', () => {
  assert.throws(() => transformTheme(fixture + 'grant insert on private.published_theme_assignments to authenticated;'),
    /transaction boundary changed|expose publication/);
  assert.throws(() => transformTheme(fixture.replace('public.tenants','public.profiles')),
    /Unreviewed M7 public dependency/);
  assert.throws(() => transformTheme(fixture.replace('public.read_tenant_theme(target',
    'public.publish_tenant_theme(target')), /Unreviewed M7 public dependency|security marker missing/);
  assert.throws(() => transformTheme(fixture.replace('revoke create on schema private',
    'grant create on schema public')), /security marker missing|expose publication/);
});
test('refuses weaker executor, missing immutable guards and malformed transaction', () => {
  assert.throws(() => transformTheme(fixture.replace('nobypassrls', 'bypassrls')),
    /security marker missing/);
  assert.throws(() => transformTheme(fixture.replace('before update or delete or truncate',
    'before insert')), /security marker missing/);
  assert.throws(() => transformTheme(fixture.replace('commit;', 'rollback;')),
    /transaction boundary changed/);
});
