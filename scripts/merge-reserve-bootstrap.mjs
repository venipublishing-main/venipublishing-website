#!/usr/bin/env node
// LOCAL-ONLY M2.2 tenant bootstrap translation; generates a non-deployable
// preview. This script never connects to Supabase or mutates a database.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './merge-reserve-m1.mjs';

export const SOURCE_BOOTSTRAP = Object.freeze({
  id: 'm22-bootstrap',
  filename: '20261113111616_tenant_bootstrap.sql',
  blob: '1660931b47eb5415eaa1bd64d284ea499b461479',
});

const domainRelations = [
  'users', 'tenants', 'memberships', 'membership_roles', 'roles', 'audit_events',
];
const publicFunctions = [
  'current_reserve_user', 'bootstrap_setup_tenant', 'list_setup_tenants',
  'read_tenant_business_settings', 'save_tenant_business_settings',
];

function requireExactlyOnce(sql, marker) {
  const first = sql.indexOf(marker);
  if (first < 0 || sql.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`M2.2 source marker missing/duplicated: ${marker}`);
  }
}

export function transformBootstrap(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty M2.2 bootstrap source');
  if (!/^--[^\n]*\n\s*begin;/i.test(source) || !/\ncommit;\s*$/i.test(source)) {
    throw new Error('M2.2 transaction boundary changed');
  }
  for (const marker of [
    'create function private.authenticated_session_user() returns uuid',
    'create function public.current_reserve_user() returns uuid',
    'create role veni_bootstrap_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;',
    'grant usage on schema private,public to veni_bootstrap_executor;',
    'create table private.tenant_bootstrap_requests (',
    'create policy bootstrap_receipts on private.tenant_bootstrap_requests',
    'create function private.bootstrap_setup_tenant(request_key uuid) returns jsonb',
    "if current_setting('transaction_isolation')<>'serializable' then",
    'alter function private.bootstrap_setup_tenant(uuid) owner to veni_bootstrap_executor;',
    'create function public.bootstrap_setup_tenant(request_key uuid) returns jsonb',
    "set default_transaction_isolation='serializable'",
    'create or replace function public.read_tenant_business_settings(target uuid) returns jsonb',
    'create or replace function public.save_tenant_business_settings(target uuid,expected_revision private.settings_wire_revision,',
    'create function public.list_setup_tenants() returns jsonb',
    'revoke veni_bootstrap_executor from postgres;',
    "notify pgrst,'reload schema';",
  ]) requireExactlyOnce(source, marker);

  // A pinned Git blob is checked by the CLI as well. This whitelist prevents
  // a future unreviewed public dependency from being silently translated.
  for (const match of source.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!domainRelations.includes(match[1]) && !publicFunctions.includes(match[1])) {
      throw new Error(`Unexpected source M2.2 public reference: public.${match[1]}`);
    }
  }
  if (/\bcreate\s+(?:or\s+replace\s+)?(?:table|view)\s+public\./i.test(source) ||
      /\b(?:grant|revoke)\s+(?:all|create|usage)\s+on\s+schema\s+public\b/i.test(source)) {
    throw new Error('M2.2 attempts to alter shared public tables or schema grants');
  }

  let sql = source.replace(/\bpublic\.(users|tenants|memberships|membership_roles|roles|audit_events)\b/g,
    'reserve.$1');
  sql = sql.replace(/\bpublic\.(current_reserve_user|bootstrap_setup_tenant|list_setup_tenants|read_tenant_business_settings|save_tenant_business_settings)\b/g,
    'public.reserve_$1');
  sql = sql.replace(/\bprivate\./g, 'reserve_internal.');
  sql = sql.replace(/\bschema private\b/g, 'schema reserve_internal');
  sql = sql.replace(/\bveni_bootstrap_executor\b/g, 'reserve_bootstrap_executor');

  // Bootstrap's NOLOGIN executor has no reason to see the parent Website's
  // public schema. It needs only Reserve's two namespaces.
  const originalGrant = 'grant usage on schema reserve_internal,public to reserve_bootstrap_executor;';
  requireExactlyOnce(sql, originalGrant);
  sql = sql.replace(originalGrant,
    'grant usage on schema reserve_internal,reserve to reserve_bootstrap_executor;');

  for (const match of sql.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!publicFunctions.some(name => match[1] === `reserve_${name}`)) {
      throw new Error(`Unconverted shared public dependency: public.${match[1]}`);
    }
  }
  if (/\bprivate\.|\bschema private\b|\bveni_bootstrap_executor\b/i.test(sql) ||
      /\bcreate\s+(?:or\s+replace\s+)?(?:table|view)\s+public\./i.test(sql)) {
    throw new Error('M2.2 isolation transformation incomplete');
  }
  return '-- LOCAL-ONLY RESERVE M2.2 BOOTSTRAP PREVIEW; not an authorized migration.\n' + sql;
}

function usage() {
  throw new Error('Usage: node scripts/merge-reserve-bootstrap.mjs --reserve-root /path/to/Reserve --out-dir /path/to/nondeployable-preview');
}

async function main(args) {
  const opts = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--')) usage();
    opts.set(args[i], args[i + 1]);
  }
  if (opts.size !== 2 || !opts.has('--reserve-root') || !opts.has('--out-dir')) usage();
  const inputRoot = resolve(opts.get('--reserve-root'));
  const outputRoot = resolve(opts.get('--out-dir'));
  if (outputRoot.split(sep).filter(Boolean).slice(-2).join('/') === 'supabase/migrations') {
    throw new Error('Bootstrap preview must not be written into deployable migrations');
  }
  const source = await readFile(join(inputRoot, 'supabase', 'migrations', SOURCE_BOOTSTRAP.filename), 'utf8');
  const sha = gitBlobSha(source);
  if (sha !== SOURCE_BOOTSTRAP.blob) {
    throw new Error(`M2.2 upstream Git blob drift (${sha}); human review required`);
  }
  const sql = transformBootstrap(source);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, 'preview-5-m22-bootstrap.sql'), sql, { flag: 'wx' });
  process.stdout.write(`preview-5-m22-bootstrap.sql: pinned blob ${sha}; PREVIEW ONLY; no database mutation.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
