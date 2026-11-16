// Disposable two-stack Auth merge rehearsal ONLY. Never point at a hosted DB.
// Tests a selective, password-hash-preserving import into an occupied Website
// Auth database; does not copy sessions or make any production migration.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function localUrl(name, raw, protocols) {
  assert.ok(raw, `${name} required`);
  const url = new URL(raw);
  assert.ok(protocols.includes(url.protocol), `${name}: invalid protocol`);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), `${name}: loopback required`);
  assert.ok(Number(url.port) >= 20000 && Number(url.port) <= 32767,
    `${name}: disposable stack port required`);
  return url;
}

assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE, 'yes');
const source = {
  api: localUrl('SOURCE_API_URL', process.env.SOURCE_API_URL, ['http:']),
  db: localUrl('SOURCE_DB_URL', process.env.SOURCE_DB_URL, ['postgres:', 'postgresql:']),
  anon: process.env.SOURCE_ANON_KEY,
};
const target = {
  api: localUrl('TARGET_API_URL', process.env.TARGET_API_URL, ['http:']),
  db: localUrl('TARGET_DB_URL', process.env.TARGET_DB_URL, ['postgres:', 'postgresql:']),
  anon: process.env.TARGET_ANON_KEY,
};
assert.ok(source.anon && target.anon);
assert.notEqual(source.db.port, target.db.port);
assert.notEqual(source.api.origin, target.api.origin);
assert.equal(source.db.pathname, '/postgres');
assert.equal(target.db.pathname, '/postgres');

function psql(db, sql) {
  // Supply SQL on stdin so disposable password hashes are not process args.
  return execFileSync('psql', [db.href, '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-f', '-'], {
    input: sql, encoding: 'utf8', timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function auth(project, path, { method='GET', bearer, body }={}) {
  const headers = { apikey: project.anon };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  else if (project.anon.startsWith('eyJ')) headers.authorization = `Bearer ${project.anon}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, project.api), {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function signup(project, email, password) {
  const response = await auth(project, '/auth/v1/signup', {
    method: 'POST', body: { email, password, data: { display_name: 'Synthetic CI User' } },
  });
  assert.equal(response.status, 200, `Synthetic local signup failed (HTTP ${response.status})`);
  assert.ok(response.data.user?.id && response.data.access_token);
  return response.data;
}

async function signin(project, email, password) {
  return auth(project, '/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password },
  });
}

function singleJson(db, sql) {
  const raw = psql(db, sql);
  assert.ok(raw.startsWith('{') || raw.startsWith('['), 'Expected local JSON record');
  return JSON.parse(raw);
}

function quoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function writableColumns(db, table) {
  const names = singleJson(db, `
    SELECT coalesce(json_agg(column_name ORDER BY ordinal_position), '[]'::json)::text
    FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = ${quoted(table)}
      AND is_generated = 'NEVER' AND is_identity = 'NO';`);
  assert.ok(names.length >= 5, `Unexpected Auth schema: ${table}`);
  assert.ok(names.includes('id'));
  return names;
}

function mergeStatement(table, record, columns) {
  assert.ok(['users', 'identities'].includes(table));
  for (const field of columns) assert.match(field, /^[a-z_][a-z_0-9]*$/i);
  const names = columns.map((field) => `"${field}"`).join(', ');
  return `INSERT INTO auth.${table} (${names})
    SELECT ${names} FROM json_populate_record(NULL::auth.${table},
      ${quoted(JSON.stringify(record))}::json);`;
}

function sourceRecords(id) {
  return singleJson(source.db, `
    SELECT json_build_object(
      'user', (SELECT row_to_json(u) FROM auth.users AS u WHERE id = ${quoted(id)}::uuid),
      'identities', (SELECT coalesce(json_agg(row_to_json(i)), '[]'::json)
                     FROM auth.identities AS i WHERE user_id = ${quoted(id)}::uuid)
    )::text;`);
}

function mergeTransaction(records, userColumns, identityColumns, faultInjection='') {
  return [
    'BEGIN;',
    mergeStatement('users', records.user, userColumns),
    ...records.identities.map((identity) => mergeStatement('identities', identity, identityColumns)),
    faultInjection,
    'COMMIT;',
  ].join('\n');
}

function countByUser(table, id) {
  assert.ok(['auth.users', 'auth.identities', 'public.profiles'].includes(table));
  const foreignKey = table === 'auth.identities' ? 'user_id' : 'id';
  return psql(target.db, `SELECT count(*) FROM ${table} WHERE ${foreignKey} = ${quoted(id)}::uuid`);
}

// Every account is synthetic and gets a fresh randomized invalid-domain email.
const marker = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const existingEmail = `existing-website-${marker}@example.invalid`;
const importedEmail = `hashed-reserve-${marker}@example.invalid`;
const existingPassword = `Website-Only-${marker}-37!`;
const originalPassword = `Preserved-Source-${marker}-19!`;

const existing = await signup(target, existingEmail, existingPassword);
const importedFrom = await signup(source, importedEmail, originalPassword);
const oldId = importedFrom.user.id;
const existingId = existing.user.id;
assert.notEqual(oldId, existingId);
assert.ok((await signin(target, importedEmail, originalPassword)).status >= 400,
  'Website must initially reject a Reserve-only login');

const rows = sourceRecords(oldId);
assert.equal(rows.user?.id, oldId);
assert.equal(rows.user?.email, importedEmail);
assert.ok(rows.user?.encrypted_password, 'Must be an actual existing password hash');
assert.ok(rows.identities.length >= 1, 'Local GoTrue must have created an identity');
assert.ok(rows.identities.every((id) => id.user_id === oldId));

for (const table of ['users', 'identities']) {
  const sourceCols = writableColumns(source.db, table);
  const destCols = writableColumns(target.db, table);
  assert.deepEqual(destCols, sourceCols, `Auth ${table} versions must match exactly`);
}
const userColumns = writableColumns(target.db, 'users');
const identityColumns = writableColumns(target.db, 'identities');

// Insertion is atomic. The pre-existing Website user is untouched, and a
// failed identity insert rolls the newly inserted user back as well.
const importSql = mergeTransaction(rows, userColumns, identityColumns);
psql(target.db, importSql);

const restored = await signin(target, importedEmail, originalPassword);
assert.equal(restored.status, 200, `Password-hash login failed on Website (HTTP ${restored.status})`);
assert.equal(restored.data.user?.id, oldId, 'Original Reserve Auth UUID should survive');
assert.ok(restored.data.access_token, 'Website must issue a new access token');

const preExistingAfter = await signin(target, existingEmail, existingPassword);
assert.equal(preExistingAfter.status, 200, 'Existing Website login must still work');
assert.equal(preExistingAfter.data.user?.id, existingId, 'Existing Website UUID must not change');
assert.equal(countByUser('public.profiles', oldId), '1',
  'Website profile creation must remain functional for imported Auth accounts');

const oldToken = await auth(target, '/auth/v1/user', { bearer: importedFrom.access_token });
assert.ok(oldToken.status >= 400, 'Previous Reserve JWT still must be rejected on Website');
const oldRefresh = await auth(target, '/auth/v1/token?grant_type=refresh_token', {
  method: 'POST', body: { refresh_token: importedFrom.refresh_token },
});
assert.ok(oldRefresh.status >= 400, 'Previous Reserve refresh token must not work on Website');
assert.equal(psql(target.db, `SELECT count(*) FROM auth.sessions WHERE user_id = ${quoted(oldId)}::uuid`), '1',
  'Only the newly authenticated Website session should exist');

// Identity collision test. The destination already has a different real
// Website account under this email, so we must ABORT, never silently match by
// string equality, overwrite the target, or leave dangling imported rows.
const collisionEmail = `same-email-${marker}@example.invalid`;
const collisionSourcePassword = `Source-Collision-${marker}-15!`;
const collisionTargetPassword = `Target-Collision-${marker}-28!`;
const collisionSource = await signup(source, collisionEmail, collisionSourcePassword);
const collisionTarget = await signup(target, collisionEmail, collisionTargetPassword);
assert.notEqual(collisionSource.user.id, collisionTarget.user.id);
let collisionRejected = false;
try {
  psql(target.db, mergeTransaction(sourceRecords(collisionSource.user.id), userColumns, identityColumns));
} catch {
  collisionRejected = true; // Expected unique-email constraint, deliberately no secret logging.
}
assert.ok(collisionRejected, 'Import must fail closed on existing Website email identity');
assert.equal(countByUser('auth.users', collisionSource.user.id), '0');
assert.equal(countByUser('auth.identities', collisionSource.user.id), '0');
assert.equal(countByUser('public.profiles', collisionSource.user.id), '0');
assert.equal((await signin(target, collisionEmail, collisionTargetPassword)).data.user?.id,
  collisionTarget.user.id, 'Target must continue to own the colliding email');
assert.ok((await signin(target, collisionEmail, collisionSourcePassword)).status >= 400,
  'Source password must not displace the pre-existing Website password');

// Forced failure *after* both source Auth objects have been inserted. The
// transaction must reverse users, identities and profile-trigger effects.
const interruptedEmail = `forced-rollback-${marker}@example.invalid`;
const interrupted = await signup(source, interruptedEmail, `Forced-Rollback-${marker}-77!`);
let rollbackRejected = false;
try {
  psql(target.db, mergeTransaction(sourceRecords(interrupted.user.id), userColumns,
    identityColumns, 'SELECT 1/0;'));
} catch {
  rollbackRejected = true;
}
assert.ok(rollbackRejected, 'Injected import failure must abort the transaction');
for (const table of ['auth.users', 'auth.identities', 'public.profiles']) {
  assert.equal(countByUser(table, interrupted.user.id), '0',
    `${table} must not retain an interrupted account`);
}

console.log('PASS: local auth.users + auth.identities import preserved original UUID and password without reset');
console.log('PASS: pre-existing Website Auth account, profile trigger, and both logins still work');
console.log('PASS: old Reserve JWT and refresh token rejected; only fresh Website session works');
console.log('PASS: matching email with a different Website UUID aborts atomically without overwrite');
console.log('PASS: injected failure after Auth identities insertion rolls back user and profile trigger');
console.log('GATE OPEN: provider/MFA inventory, same-email collisions, hosted Auth schema compatibility and explicit cutover review');
