#!/usr/bin/env node
// LOCAL-ONLY preview generator. This script does not connect to Supabase.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCES = Object.freeze([
  {
    id: 'm1a',
    filename: '20261030154642_m1_1a_tenant_user_membership_persistence.sql',
    blob: 'ab260eda829c7bd10af2cdc2e70c948e89d388e0',
  },
  {
    id: 'm1b',
    filename: '20261030174937_m1_1b_role_permission_invitation_audit_foundation.sql',
    blob: '050b7edc6f194d2990cc23ff1fe39b6b34dec5e2',
  },
  {
    id: 'm12',
    filename: '20261031031256_m1_2_rls_cross_tenant_security.sql',
    blob: '3593761e05bdca08c8da9a6f2b691a6e0290868c',
  },
]);

const reserveRelations = [
  'tenants', 'users', 'memberships', 'permissions', 'roles',
  'role_permissions', 'membership_roles', 'audit_events',
];
const relationPattern = new RegExp(`\\bpublic\\.(${reserveRelations.join('|')})\\b`, 'g');

export function gitBlobSha(content) {
  const data = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${data.length}\0`, 'utf8').update(data).digest('hex');
}

function replaceExactlyOnce(text, oldText, replacement, label) {
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: expected exactly one source marker: ${oldText}`);
  }
  return text.slice(0, first) + replacement + text.slice(first + oldText.length);
}

export function transformM1(id, source) {
  if (!SOURCES.some(item => item.id === id)) throw new Error(`Unknown M1 step: ${id}`);
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty SQL source');

  // Every upstream qualified reference is expected to be a Reserve relation or
  // a Reserve internal helper. A new public dependency needs human review.
  for (const match of source.matchAll(/\bpublic\.([a-z_][a-z_0-9]*)\b/g)) {
    if (!reserveRelations.includes(match[1])) {
      throw new Error(`Unexpected source public reference: public.${match[1]}`);
    }
  }

  let sql = source.replace(relationPattern, 'reserve.$1');
  sql = sql.replace(/\bprivate\./g, 'reserve_internal.');
  sql = sql.replace(/\bschema private\b/g, 'schema reserve_internal');

  if (id === 'm1a') {
    sql = `begin;\ncreate schema if not exists reserve;\n` +
      `revoke all on schema reserve from public, anon, authenticated, service_role;\n\n` +
      `${sql.trimEnd()}\ncommit;\n`;
  }

  if (id === 'm1b') {
    sql = replaceExactlyOnce(sql, 'create schema if not exists private;',
      'create schema if not exists reserve_internal;', 'm1b internal schema');
    sql = `begin;\n${sql.trimEnd()}\ncommit;\n`;
  }

  if (id === 'm12') {
    // Unlike the original standalone deployment, this MUST NOT revoke CREATE
    // on shared public: the website already owns objects in that namespace.
    sql = replaceExactlyOnce(sql,
      'revoke create on schema public from public, anon, authenticated, service_role;',
      'revoke create on schema reserve from public, anon, authenticated, service_role;',
      'm12 shared public privilege');
    sql = replaceExactlyOnce(sql,
      "schemaname in ('public', 'private')",
      "schemaname in ('reserve', 'reserve_internal')",
      'm12 owner guard');
    sql = replaceExactlyOnce(sql, "n.nspname = 'public'", "n.nspname = 'reserve'", 'm12 relation grants');
    sql = replaceExactlyOnce(sql, "n.nspname = 'private'", "n.nspname = 'reserve_internal'", 'm12 private grants');
    // Authenticated relations remain RLS-protected, but reserve is intentionally
    // NOT an exposed PostgREST schema. Server/RPC adapters are a later phase.
    sql = replaceExactlyOnce(sql, '\ncommit;',
      '\ngrant usage on schema reserve to authenticated;\ncommit;', 'm12 ending');
  }

  if (/\bpublic\.[a-z_][a-z_0-9]*\b|\bprivate\.[a-z_][a-z_0-9]*\b|\bschema private\b/i.test(sql)) {
    throw new Error(`${id}: unconverted qualified schema reference`);
  }
  if (/\b(?:revoke|grant|alter|drop)\s+create\s+on\s+schema\s+public\b/i.test(sql)) {
    throw new Error(`${id}: unsafe mutation of shared public schema`);
  }
  return `-- LOCAL-ONLY RESERVE M1 PREVIEW: ${id}; do not deploy without integration tests.\n${sql}`;
}

function usage() {
  throw new Error('Usage: node scripts/merge-reserve-m1.mjs --reserve-root /path/to/veni-reserve --out-dir /path/to/preview-output');
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
  const normalizedOutput = outputRoot.split(sep).filter(Boolean);
  if (normalizedOutput.slice(-2).join('/') === 'supabase/migrations') {
    throw new Error('Preview output must NOT be a deployable supabase/migrations directory');
  }

  // Validate every input before creating or writing any output.
  const previews = [];
  for (const item of SOURCES) {
    const src = await readFile(join(inputRoot, 'supabase', 'migrations', item.filename), 'utf8');
    const sha = gitBlobSha(src);
    if (sha !== item.blob) {
      throw new Error(`${item.filename}: upstream file changed (${sha}); audit required before regeneration`);
    }
    previews.push({ id: item.id, sha, sql: transformM1(item.id, src) });
  }

  await mkdir(outputRoot, { recursive: true });
  for (const [index, preview] of previews.entries()) {
    const name = `preview-${index + 1}-${preview.id}.sql`;
    await writeFile(join(outputRoot, name), preview.sql, { flag: 'wx' });
    process.stdout.write(`${name}: source Git blob ${preview.sha}\n`);
  }
  process.stdout.write('PREVIEW ONLY. Nothing was applied to a database.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
