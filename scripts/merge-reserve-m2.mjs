#!/usr/bin/env node
// LOCAL-ONLY M2.1 conversion. Never imports or modifies a hosted project.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './merge-reserve-m1.mjs';

export const SOURCE_M2 = Object.freeze({
  id: 'm21',
  filename: '20261103160923_tenant_business_settings.sql',
  blob: 'bdca9ea088e2b48095fac38ad5ef728f086042d3',
});

const sourceDomainRelations = ['tenants', 'users', 'memberships'];
const sourcePublicRpcs = ['read_tenant_business_settings', 'save_tenant_business_settings'];

function requireOne(source, marker) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`M2.1 expected exactly one critical source marker: ${marker}`);
  }
}

export function transformM2(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty Reserve M2.1 SQL source');

  // The only public SQL entry points in M2.1 are two intentional, bounded RPCs.
  // Any future public name must receive explicit review before translation.
  for (const match of source.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!sourceDomainRelations.includes(match[1]) && !sourcePublicRpcs.includes(match[1])) {
      throw new Error(`Unexpected M2.1 public dependency: public.${match[1]}`);
    }
  }
  for (const marker of [
    'create role veni_settings_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit;',
    'create function private.settings_actor() returns uuid',
    'create table private.settings_reference (',
    'create table private.tenant_business_settings (',
    'create table private.tenant_business_settings_changes (',
    'create function public.read_tenant_business_settings(target uuid) returns jsonb',
    'create function public.save_tenant_business_settings(target uuid,expected_revision private.settings_wire_revision,',
    'revoke veni_settings_executor from postgres;',
  ]) requireOne(source, marker);
  if (!/^\s*--[^\n]*\n\s*begin;/i.test(source) || !/\ncommit;\s*$/i.test(source)) {
    throw new Error('M2.1 transaction boundary changed; review required');
  }

  let sql = source.replace(/\bpublic\.(tenants|users|memberships)\b/g, 'reserve.$1');
  sql = sql.replace(/\bpublic\.(read_tenant_business_settings|save_tenant_business_settings)\b/g,
    'public.reserve_$1');
  sql = sql.replace(/\bprivate\./g, 'reserve_internal.');
  sql = sql.replace(/\bschema private\b/g, 'schema reserve_internal');
  // The original role is cluster-global. Give it a Reserve-specific name so
  // other Veni Spheres cannot accidentally inherit its grants or identity.
  sql = sql.replace(/\bveni_settings_executor\b/g, 'reserve_settings_executor');

  for (const match of sql.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!sourcePublicRpcs.some(name => match[1] === `reserve_${name}`)) {
      throw new Error(`Unreviewed shared-public reference after M2.1 conversion: public.${match[1]}`);
    }
  }
  if (/\bprivate\.|\bschema private\b|\bveni_settings_executor\b/i.test(sql)) {
    throw new Error('Unconverted Reserve-private name or global execution role');
  }
  if (/\b(?:revoke|grant|alter|drop)\s+create\s+on\s+schema\s+public\b/i.test(sql)) {
    throw new Error('M2.1 attempts to change the website public schema privileges');
  }
  if (/\bcreate\s+table\s+public\./i.test(sql)) {
    throw new Error('M2.1 attempted to add a shared-public relation');
  }

  return '-- LOCAL-ONLY RESERVE M2.1 PREVIEW; never deploy without integration tests.\n' + sql;
}

function usage() {
  throw new Error('Usage: node scripts/merge-reserve-m2.mjs --reserve-root /path/to/veni-reserve --out-dir /path/to/preview-output');
}

async function main(args) {
  const opts = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i+1] || args[i+1].startsWith('--')) usage();
    opts.set(args[i], args[i+1]);
  }
  if (opts.size !== 2 || !opts.has('--reserve-root') || !opts.has('--out-dir')) usage();
  const inputRoot = resolve(opts.get('--reserve-root'));
  const outputRoot = resolve(opts.get('--out-dir'));
  if (outputRoot.split(sep).filter(Boolean).slice(-2).join('/') === 'supabase/migrations') {
    throw new Error('Preview output must not be a deployable supabase/migrations directory');
  }

  const source = await readFile(join(inputRoot, 'supabase', 'migrations', SOURCE_M2.filename), 'utf8');
  const actual = gitBlobSha(source);
  if (actual !== SOURCE_M2.blob) {
    throw new Error(`M2.1 Git blob changed (${actual}), audit required`);
  }
  const sql = transformM2(source);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, 'preview-4-m21.sql'), sql, { flag: 'wx' });
  process.stdout.write(`preview-4-m21.sql: source Git blob ${actual}\nPREVIEW ONLY. No database was modified.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
