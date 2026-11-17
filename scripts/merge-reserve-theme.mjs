#!/usr/bin/env node
// LOCAL-ONLY M7 private Theme revision conversion. Output is a SQL preview,
// never a deployable migration or an instruction to modify hosted Supabase.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './merge-reserve-m1.mjs';

export const SOURCE_THEME = Object.freeze({
  id: 'm7-private-theme',
  filename: '20261114110626_theme_revisions_private_drafts.sql',
  blob: '457669782a5dcb00f3c851f89c9f3cd7fa0b959f',
});

const domainRelations = ['tenants', 'users', 'memberships'];
const themeRpcs = [
  'list_tenant_themes', 'read_tenant_theme', 'read_tenant_theme_revision',
  'create_tenant_theme', 'save_tenant_theme_revision',
];
function requireOnce(sql, marker) {
  const index = sql.indexOf(marker);
  if (index<0 || sql.indexOf(marker,index+marker.length)>=0) {
    throw new Error(`M7 Theme SQL security marker missing/duplicated: ${marker}`);
  }
}

export function transformTheme(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty M7 Theme SQL source');
  if (!/^\s*(?:--[^\n]*\n)*\s*begin;/i.test(source) || !/\ncommit;\s*$/i.test(source)) {
    throw new Error('M7 Theme transaction boundary changed');
  }
  for (const marker of [
    'create role veni_theme_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;',
    'grant usage on schema private to veni_theme_executor;',
    'create function private.normalized_theme_tokens(value jsonb) returns jsonb',
    'create table private.themes (',
    'create table private.theme_revisions (',
    'create table private.theme_revision_events (',
    'create table private.published_theme_assignments (',
    'alter table private.published_theme_assignments enable row level security;',
    'create trigger theme_revisions_immutable before update or delete or truncate on private.theme_revisions',
    'create trigger theme_revision_events_immutable before update or delete or truncate on private.theme_revision_events',
    'create policy theme_create on private.themes',
    'create policy theme_revision_append on private.theme_revisions',
    'create policy theme_event_append on private.theme_revision_events',
    'create function private.list_tenant_themes(target uuid) returns jsonb',
    'create function private.read_tenant_theme(target uuid,theme uuid) returns jsonb',
    'create function private.read_tenant_theme_revision(target uuid,theme uuid,requested integer) returns jsonb',
    'create function private.create_tenant_theme(target uuid,theme_name text,design_tokens jsonb) returns jsonb',
    'create function private.save_tenant_theme_revision(target uuid,theme uuid,expected integer,design_tokens jsonb) returns jsonb',
    'create function public.list_tenant_themes(target uuid) returns jsonb',
    'create function public.read_tenant_theme(target uuid,theme uuid) returns jsonb',
    'create function public.read_tenant_theme_revision(target uuid,theme uuid,requested private.settings_wire_revision) returns jsonb',
    'create function public.create_tenant_theme(target uuid,theme_name private.settings_wire_text,design_tokens jsonb) returns jsonb',
    'create function public.save_tenant_theme_revision(target uuid,theme uuid,expected private.settings_wire_revision,design_tokens jsonb) returns jsonb',
    'grant create on schema private to veni_theme_executor;',
    'revoke create on schema private from veni_theme_executor;',
    'revoke veni_theme_executor from postgres;',
    "notify pgrst,'reload schema';",
  ]) requireOnce(source, marker);

  for (const match of source.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!domainRelations.includes(match[1]) && !themeRpcs.includes(match[1])) {
      throw new Error(`Unreviewed M7 public dependency: public.${match[1]}`);
    }
  }
  if (/\b(?:create|alter|drop)\s+(?:table|view)\s+public\./i.test(source) ||
      /\b(?:grant|revoke)\s+(?:all|usage|create)\s+on\s+schema\s+public\b/i.test(source) ||
      /\bgrant\s+(?:insert|update|delete|truncate|all)\s+on\s+private\.published_theme_assignments\b/i.test(source) ||
      /\bcreate\s+(?:or\s+replace\s+)?function\s+public\.publish/i.test(source)) {
    throw new Error('M7 Theme attempts to expose publication or shared Website data');
  }

  let sql = source.replace(/\bpublic\.(tenants|users|memberships)\b/g, 'reserve.$1');
  sql = sql.replace(/\bpublic\.(list_tenant_themes|read_tenant_theme|read_tenant_theme_revision|create_tenant_theme|save_tenant_theme_revision)\b/g,
    'public.reserve_$1');
  sql = sql.replace(/\bprivate\./g, 'reserve_internal.');
  sql = sql.replace(/\bschema private\b/g, 'schema reserve_internal');
  sql = sql.replace(/\bveni_theme_executor\b/g, 'reserve_theme_executor');
  for (const match of sql.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!themeRpcs.some(name => match[1] === `reserve_${name}`)) {
      throw new Error(`Shared-public M7 function was not safely isolated: public.${match[1]}`);
    }
  }
  if (/\bprivate\.|\bschema private\b|\bveni_theme_executor\b/i.test(sql)) {
    throw new Error('M7 private schema or execution role remains unconverted');
  }
  return '-- LOCAL-ONLY M7 PRIVATE THEME PREVIEW; NEVER DEPLOY as-is.\n' + sql;
}

function usage() {
  throw new Error('Usage: node scripts/merge-reserve-theme.mjs --reserve-root /path/to/Reserve-PR22 --out-dir /path/to/nondeployable-preview');
}
async function main(args) {
  const opts = new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!args[i]?.startsWith('--') || !args[i+1] || args[i+1].startsWith('--')) usage();
    opts.set(args[i], args[i+1]);
  }
  if(opts.size!==2 || !opts.has('--reserve-root') || !opts.has('--out-dir')) usage();
  const inputRoot = resolve(opts.get('--reserve-root'));
  const outputRoot = resolve(opts.get('--out-dir'));
  if(outputRoot.split(sep).filter(Boolean).slice(-2).join('/')==='supabase/migrations') {
    throw new Error('M7 Theme output cannot be a deployable migration directory');
  }
  const src = await readFile(join(inputRoot,'supabase','migrations',SOURCE_THEME.filename),'utf8');
  const hash = gitBlobSha(src);
  if(hash!==SOURCE_THEME.blob) throw new Error(`M7 source Git blob drift (${hash}); independent review required`);
  const sql = transformTheme(src);
  await mkdir(outputRoot,{recursive:true});
  await writeFile(join(outputRoot,'preview-6-m7-private-theme.sql'),sql,{flag:'wx'});
  process.stdout.write(`preview-6-m7-private-theme.sql: source blob ${hash}; PREVIEW ONLY.\n`);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error=>{
    process.stderr.write(`${error.message}\n`);
    process.exitCode=1;
  });
}
