// Genuine disposable GoTrue SOURCE + WEBSITE TARGET handoff experiment.
// Two separate local Supabase projects; no hosted project refs or real users.
// This proves why a source UUID/session/password cannot be assumed portable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function loopback(name, value, protocols) {
  assert.ok(value, `Missing local ${name}`);
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol), `${name} protocol must be local HTTP/PostgreSQL`);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), `${name} must be loopback only`);
  assert.ok(Number(url.port) >= 20000 && Number(url.port) <= 32767,
    `${name} must use the experimental disposable CLI stack port range`);
  return url;
}

assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE, 'yes', 'CI-only dual Auth experiment');
const src = {
  api: loopback('SOURCE_API_URL', process.env.SOURCE_API_URL, ['http:']),
  db: loopback('SOURCE_DB_URL', process.env.SOURCE_DB_URL, ['postgres:', 'postgresql:']),
  key: process.env.SOURCE_ANON_KEY,
};
const dst = {
  api: loopback('TARGET_API_URL', process.env.TARGET_API_URL, ['http:']),
  db: loopback('TARGET_DB_URL', process.env.TARGET_DB_URL, ['postgres:', 'postgresql:']),
  key: process.env.TARGET_ANON_KEY,
};
assert.ok(src.key && dst.key, 'Both local project anon keys required');
assert.notEqual(src.api.origin, dst.api.origin, 'Source and Website must have independent API ports');
assert.notEqual(src.db.port, dst.db.port, 'Source and Website must have independent Postgres ports');
assert.equal(src.db.pathname, '/postgres');
assert.equal(dst.db.pathname, '/postgres');

async function request(project, path, { method='GET', token, body }={}) {
  const headers = { apikey: project.key };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (project.key.startsWith('eyJ')) headers.Authorization = `Bearer ${project.key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(new URL(path, project.api), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch { /* Only status matters for malformed-token tests. */ }
  return { status: res.status, data };
}

async function expectSuccess(project, path, args) {
  const r = await request(project, path, args);
  assert.ok(r.status >= 200 && r.status < 300,
    `Local Auth ${path} failed (HTTP ${r.status}): ${JSON.stringify(r.data).slice(0,300)}`);
  return r.data;
}

function verifyAuth(session, purpose) {
  assert.match(session.user?.id || '', UUID, `${purpose} requires real GoTrue user UUID`);
  assert.ok(session.access_token && session.refresh_token, `${purpose} requires real tokens`);
  return session;
}

function psql(dbUrl, sql) {
  return execFileSync('psql', [dbUrl.href, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', timeout: 30000,
  }).trim();
}

const marker = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `owner-handoff-${marker}@example.invalid`;
const oldPassword = `Only-Source-${marker}-12!`;
const newPassword = `Only-Target-${marker}-34!`;

// Source Reserve identity signs in to SOURCE GoTrue, not the Website backend.
const original = verifyAuth(await expectSuccess(src, '/auth/v1/signup', {
  method: 'POST', body: { email, password: oldPassword, data: { display_name: 'Source Owner' } },
}), 'Original Reserve login');
assert.equal((await expectSuccess(src, '/auth/v1/user', { token: original.access_token })).id, original.user.id);

// Website has a separately provisioned account with the same verified email.
// This is explicitly a synthetic, user-approved re-registration; no password
// or provider credentials were copied from the old Auth project.
const canonical = verifyAuth(await expectSuccess(dst, '/auth/v1/signup', {
  method: 'POST', body: { email, password: newPassword, data: { display_name: 'Website Account' } },
}), 'New Website login');
assert.notEqual(canonical.user.id, original.user.id,
  'Two GoTrue projects normally allocate different account IDs; link explicitly');
assert.equal((await expectSuccess(dst, '/auth/v1/user', { token: canonical.access_token })).id, canonical.user.id);
console.log('PASS: independent GoTrue projects created different UUIDs for the same synthetic email');

// A JWT, refresh token and password issued by Source are NOT a destination
// account migration. The old project also does not accept destination tokens.
for (const [destination, token] of [[dst, original.access_token], [src, canonical.access_token]]) {
  const response = await request(destination, '/auth/v1/user', { token });
  assert.ok(response.status >= 400, 'Cross-project access token must be rejected');
}
const stolenRefresh = await request(dst, '/auth/v1/token?grant_type=refresh_token', {
  method: 'POST', body: { refresh_token: original.refresh_token },
});
assert.ok(stolenRefresh.status >= 400, 'Source refresh token must not mint Website session');
const oldSignInOnTarget = await request(dst, '/auth/v1/token?grant_type=password', {
  method: 'POST', body: { email, password: oldPassword },
});
assert.ok(oldSignInOnTarget.status >= 400, 'Source password must not silently work in new Website account');
console.log('PASS: source access/refresh tokens and passwords are not portable to Website');

// A new Website login can be explicitly re-authenticated with its own new
// secret and must retain the canonical target UUID and Website profile.
const returning = verifyAuth(await expectSuccess(dst, '/auth/v1/token?grant_type=password', {
  method: 'POST', body: { email, password: newPassword },
}), 'Re-authenticated Website account');
assert.equal(returning.user.id, canonical.user.id);
assert.equal(psql(dst.db, `SELECT count(*) FROM public.profiles WHERE id='${canonical.user.id}'::uuid`), '1');
assert.equal(psql(src.db, `SELECT count(*) FROM auth.users WHERE id='${original.user.id}'::uuid`), '1');

// This mapping is an explicit HANDOFF PROPOSAL, not an automatically applied
// link. Email equality alone is insufficient for live linking; real consent,
// proof of control, replay protection and historical provenance are required.
const proposedLink = {
  sourceReserveUserId: original.user.id,
  destinationVeniAccountId: canonical.user.id,
  verifiedBothLocalSessions: true,
};
assert.match(proposedLink.sourceReserveUserId, UUID);
assert.match(proposedLink.destinationVeniAccountId, UUID);
assert.notEqual(proposedLink.sourceReserveUserId, proposedLink.destinationVeniAccountId);
console.log('PASS: explicit dual-session-verified legacy→canonical mapping is required before Reserve FK re-parenting');
console.log('GATE OPEN: production provider/MFA identity transfer, consent and history-preserving FK remap remain unimplemented');
