// Disposable SOURCE -> WEBSITE import rehearsal, deliberately NOT a production
// migrator. It copies only synthetic *.invalid identities between two local
// PostgreSQL 17 databases and refuses any other host, db or source population.
// No hosted keys, passwords, sessions, auth providers, or source secrets used.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const SOURCE = 'veni_import_source_ci';
const TARGET = 'veni_import_target_ci';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mode = process.argv[2];

if (!['--rollback', '--apply', '--verify', '--reject-replay'].includes(mode)) {
  throw new Error('Specify --rollback, --apply, --verify or --reject-replay');
}
if (process.env.VENI_DISPOSABLE_IMPORT !== 'yes'
  || !['127.0.0.1', 'localhost'].includes(process.env.PGHOST)
  || process.env.PGPORT !== '5432'
  || process.env.PGUSER !== 'postgres') {
  throw new Error('Refusing to run outside explicitly approved loopback CI fixture');
}

const manifest = [
  { from: 'auth.users', to: 'auth.users', columns: 'id,email,raw_user_meta_data,created_at', order: 'id' },
  { from: 'public.users', to: 'reserve.users', columns: 'id,created_at', order: 'id' },
  { from: 'public.tenants', to: 'reserve.tenants', columns: 'id,status,created_at', order: 'id' },
  { from: 'public.roles', to: 'reserve.roles', columns: 'id,kind,tenant_id,code,display_name,created_at', where: "kind='CUSTOM'", order: 'id' },
  { from: 'public.role_permissions', to: 'reserve.role_permissions', columns: 'role_id,permission_code', where: "role_id IN (SELECT id FROM public.roles WHERE kind='CUSTOM')", order: 'role_id,permission_code' },
  { from: 'public.memberships', to: 'reserve.memberships', columns: 'id,tenant_id,user_id,status,created_at', order: 'id' },
  { from: 'public.membership_roles', to: 'reserve.membership_roles', columns: 'membership_id,role_id,assigned_at', order: 'membership_id,role_id' },
  // issuance_xid is transaction provenance; the destination must create a new
  // issuance_xid in its own migration transaction (it must not be transplanted).
  { from: 'private.invitations', to: 'reserve_internal.invitations', columns: 'id,tenant_id,target_email,target_user_id,inviter_user_id,inviter_membership_id,created_at,expires_at,accepted_at,accepted_user_id,accepted_membership_id,revoked_at,revoked_by_membership_id,revocation_reason,supersedes_id,request_key,request_fingerprint,token_verifier', order: 'id' },
  { from: 'private.invitation_roles', to: 'reserve_internal.invitation_roles', columns: 'invitation_id,role_id', order: 'invitation_id,role_id' },
  // Stored target_* columns are generated. Preserve timestamp/ledger exactly;
  // the destination insert-time stamp normalizer must be disabled temporarily.
  { from: 'public.audit_events', to: 'reserve.audit_events', columns: 'id,tenant_id,occurred_at,action,category,actor_type,actor_user_id,actor_membership_id,service_actor,reason_code,target_type,target_id,correlation_id,metadata,schema_version', order: 'id' },
];

function psql(db, sql) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-d', db, '-c', sql],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

function jsonRows(db, sql) {
  return JSON.parse(psql(db, `SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'email',q.email) ORDER BY q.id), '[]'::jsonb) FROM (${sql}) AS q`).trim());
}

function exportCsv(db, table, columns, order, where = '') {
  const filter = where ? ` WHERE ${where}` : '';
  return psql(db, `COPY (SELECT ${columns} FROM ${table}${filter} ORDER BY ${order}) TO STDOUT WITH (FORMAT CSV, FORCE_QUOTE *)`);
}

const sourceIdentities = jsonRows(SOURCE, 'SELECT id,email FROM auth.users');
assert.equal(sourceIdentities.length, 5, 'Rehearsal only: expected exactly five synthetic source Auth users');
for (const { id, email } of sourceIdentities) {
  assert.match(id, UUID);
  assert.match(email, /^migrated-[a-z-]+@example\.invalid$/);
}
const sourceIds = new Set(sourceIdentities.map(({ id }) => id));
assert.equal(sourceIds.size, 5);

function authFilter() {
  // Only syntactically validated UUIDs from the local synthetic source are used
  // to build this verified read-only comparison predicate.
  return `id IN (${[...sourceIds].map(id => `'${id}'::uuid`).join(',')})`;
}

function compareCatalogues() {
  const catalogues = [
    { from: 'public.permissions', to: 'reserve.permissions', columns: 'code,description', order: 'code' },
    // Seed creation timestamps differ between databases and are not part of
    // the system-role permissions contract.
    { from: 'public.roles', to: 'reserve.roles', columns: 'id,kind,tenant_id,code,display_name', where: "kind='SYSTEM'", order: 'id' },
    { from: 'public.role_permissions', to: 'reserve.role_permissions', columns: 'role_id,permission_code', where: "role_id IN (SELECT id FROM public.roles WHERE kind='SYSTEM')", toWhere: "role_id IN (SELECT id FROM reserve.roles WHERE kind='SYSTEM')", order: 'role_id,permission_code' },
  ];
  for (const c of catalogues) {
    const from = exportCsv(SOURCE, c.from, c.columns, c.order, c.where);
    const to = exportCsv(TARGET, c.to, c.columns, c.order, c.toWhere || c.where);
    assert.equal(to, from, `Seed catalogue mismatch: ${c.from}; do not import`);
  }
}

function targetRecordCount() {
  return Number(psql(TARGET, `SELECT
    (SELECT count(*) FROM reserve.users)
    + (SELECT count(*) FROM reserve.tenants)
    + (SELECT count(*) FROM reserve.memberships)
    + (SELECT count(*) FROM reserve.membership_roles)
    + (SELECT count(*) FROM reserve.audit_events)
    + (SELECT count(*) FROM reserve.roles WHERE kind='CUSTOM')
    + (SELECT count(*) FROM reserve.role_permissions WHERE role_id IN (SELECT id FROM reserve.roles WHERE kind='CUSTOM'))
    + (SELECT count(*) FROM reserve_internal.invitations)
    + (SELECT count(*) FROM reserve_internal.invitation_roles)`));
}

function preflight() {
  compareCatalogues();
  assert.equal(targetRecordCount(), 0, 'Target Reserve contains dynamic data: abort');
  const existing = jsonRows(TARGET, 'SELECT id,email FROM auth.users');
  const existingIds = new Set(existing.map(({ id }) => id));
  const existingEmails = new Set(existing.map(({ email }) => email?.trim().toLowerCase()));
  for (const { id, email } of sourceIdentities) {
    assert.ok(!existingIds.has(id), `Auth UUID collision: ${id}`);
    assert.ok(!existingEmails.has(email.trim().toLowerCase()), 'Normalized Auth email collision');
  }
}

function copyBlock(entry) {
  const data = exportCsv(SOURCE, entry.from, entry.columns, entry.order,
    entry.from === 'auth.users' ? authFilter() : entry.where);
  // COPY data is generated by PostgreSQL from a fixed, synthetic fixture, not
  // interpolated SQL. The \.-line terminator is psql's stdin COPY framing.
  assert.ok(!data.split('\n').some(line => line === '\\.'), `Unexpected COPY terminator in ${entry.from}`);
  return `COPY ${entry.to} (${entry.columns}) FROM STDIN WITH (FORMAT CSV);\n${data}${data && !data.endsWith('\n') ? '\n' : ''}\\.\n`;
}

function buildImport(injectFailure) {
  let script = '\\set ON_ERROR_STOP on\nBEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n';
  for (const entry of manifest) {
    if (entry.to === 'reserve.audit_events') {
      script += 'ALTER TABLE reserve.audit_events DISABLE TRIGGER audit_guard;\n';
    }
    script += copyBlock(entry);
    if (entry.to === 'reserve.audit_events') {
      script += 'ALTER TABLE reserve.audit_events ENABLE TRIGGER audit_guard;\n';
    }
    if (injectFailure && entry.to === 'reserve.memberships') {
      script += 'SELECT 1 / 0 AS intentionally_aborted_migration;\n';
      break;
    }
  }
  if (!injectFailure) script += 'COMMIT;\n';
  return script;
}

function executeImport(injectFailure) {
  const script = buildImport(injectFailure);
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', TARGET],
    { input: script, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (injectFailure) {
    assert.notEqual(result.status, 0, 'Expected an intentional mid-transaction failure');
    assert.match(result.stderr || '', /division by zero/i);
    assert.equal(targetRecordCount(), 0, 'A failed import left partial Reserve rows');
    assert.equal(jsonRows(TARGET, 'SELECT id,email FROM auth.users').length, 2,
      'A failed import left partial shared Auth users');
    console.log('PASS: mid-import failure atomically rolled back Auth, profiles and Reserve records');
    return;
  }
  assert.equal(result.status, 0, `Import transaction failed: ${result.stderr}`);
  console.log('PASS: separate synthetic SOURCE -> WEBSITE import committed atomically');
}

function verify() {
  compareCatalogues();
  for (const entry of manifest) {
    const source = exportCsv(SOURCE, entry.from, entry.columns, entry.order,
      entry.from === 'auth.users' ? authFilter() : entry.where);
    const destFilter = entry.to === 'auth.users' ? authFilter()
      : entry.to === 'reserve.roles' ? "kind='CUSTOM'"
      : entry.to === 'reserve.role_permissions' ? "role_id IN (SELECT id FROM reserve.roles WHERE kind='CUSTOM')" : '';
    const dest = exportCsv(TARGET, entry.to, entry.columns, entry.order, destFilter);
    assert.equal(dest, source, `Source/target byte-preserving CSV comparison failed for ${entry.to}`);
  }
  assert.equal(targetRecordCount(), 22, 'Unexpected dynamic row count (5+2+1+2+4+4+1+1+2)');
  assert.equal(jsonRows(TARGET, 'SELECT id,email FROM auth.users').length, 7,
    'Shared Auth records must retain 2 Website users and import 5 Reserve users');
  assert.equal(psql(TARGET, 'SELECT count(*) FROM public.profiles').trim(), '7',
    'Veni website signup trigger must create all five imported account profiles');
  assert.equal(psql(TARGET, 'SELECT count(*) FROM public.arcana_readings').trim(), '1',
    'Existing Website Arcana readings must survive migration');
  assert.equal(psql(TARGET, "SELECT tgenabled FROM pg_trigger WHERE tgrelid='reserve.audit_events'::regclass AND tgname='audit_guard'").trim(), 'O',
    'Auditing insert guard must be re-enabled');
  console.log('PASS: imported identities, tenant graph, private invitation, ledger history and website data match');
}

if (mode === '--rollback') {
  preflight();
  executeImport(true);
} else if (mode === '--apply') {
  preflight();
  executeImport(false);
  verify();
} else if (mode === '--verify') {
  verify();
} else if (mode === '--reject-replay') {
  assert.throws(() => preflight(), /Target Reserve contains dynamic data|collision/i);
  verify();
  console.log('PASS: replay onto a populated target rejected without mutation');
}
