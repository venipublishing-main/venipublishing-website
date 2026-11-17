/**
 * Disposable Website-shared Auth → Reserve actor contract integration probe.
 * The Reserve actor module is checked out at an immutable source SHA by CI.
 * This is a test-only trusted adapter, NOT production wiring or a bypass of RLS.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolveReserveActor } from '../../../reserve-actor/app/lib/reserve-actor-contract.server.ts';

assert.equal(process.env.VENI_SHARED_ACTOR_DISPOSABLE, 'yes');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
const api = new URL(process.env.API_URL || 'http://invalid');
const db = new URL(process.env.DB_URL || 'postgres://invalid');
assert.equal(api.origin, 'http://127.0.0.1:54321');
assert.equal(db.port, '54322');
assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname));
assert.equal(db.pathname, '/postgres');
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
const key = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(key, 'Only disposable publishable/anon key is accepted');

const issuer = `${api.origin}/auth/v1`;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const valid = x => typeof x === 'string' && uuid.test(x);
const quoted = x => { assert.ok(valid(x)); return `'${x}'::uuid`; };
let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions++; }
function scalar(sql) {
  return execFileSync('psql', [db.href, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  }).trim();
}
async function request(path, { method = 'POST', token, body } = {}) {
  const headers = { apikey: key };
  if (token) headers.authorization = `Bearer ${token}`;
  else if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, api), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch { /* empty or non-JSON response */ }
  return { status: response.status, data };
}
const rpc = (name, token, body = {}) =>
  request(`/rest/v1/rpc/reserve_${name}`, { token, body });
function success(response, label) {
  check(response.status >= 200 && response.status < 300, label);
  return response.data;
}
const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Local-${randomUUID()}-Aa9!`;
async function signup(label, metadata = {}) {
  const result = success(await request('/auth/v1/signup', { body: {
    email: `actor-${label}-${stamp}@example.invalid`, password, data: metadata,
  } }), 'Disposable Auth signup succeeds');
  check(valid(result.user?.id) && !!result.access_token, 'Real UUID and live token issued');
  return { id: result.user.id, token: result.access_token };
}
async function bootstrap(account) {
  const result = success(await rpc('bootstrap_setup_tenant', account.token,
    { request_key: randomUUID() }), 'Real tenant bootstrap RPC succeeds');
  check(valid(result.tenant_id), 'Returned tenant ID is an actual UUID');
  return result.tenant_id;
}
function claims(token) {
  const pieces = token.split('.');
  check(pieces.length === 3, 'Real GoTrue signed-token shape');
  return JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8'));
}
function testAdapter(account) {
  const tokenClaims = claims(account.token);
  check(tokenClaims.iss === issuer && tokenClaims.sub === account.id &&
    valid(tokenClaims.session_id) && Number(tokenClaims.exp) * 1000 > Date.now(),
  'Verified test token has fixed local issuer, subject, session and expiry');
  return {
    async verifyLivePrincipal() {
      // A JWT payload alone is never trusted: GoTrue verifies the caller, then
      // Reserve's live-session-aware RPC must verify its active Auth session.
      const user = await request('/auth/v1/user', { method: 'GET', token: account.token });
      const live = await rpc('current_reserve_user', account.token);
      if (user.status !== 200 || user.data?.id !== account.id ||
          live.status !== 200 || live.data !== account.id) return null;
      return { issuer, subject: account.id, sessionId: tokenClaims.session_id,
        verifiedAtMs: Date.now(), expiresAtMs: Number(tokenClaims.exp) * 1000,
        sessionActive: true, identityVerified: true, anonymous: false };
    },
    async lookupIdentityBindings(actualIssuer, subject) {
      if (actualIssuer !== issuer || !valid(subject)) return [];
      const rows = scalar(`select id::text from reserve.users where id=${quoted(subject)}`);
      return rows ? rows.split('\n').map(id => ({ issuer, subject, reserveUserId: id })) : [];
    },
    async lookupMemberships(userId, tenantId) {
      if (!valid(userId) || !valid(tenantId)) return [];
      const json = scalar(`select coalesce(json_agg(json_build_object(
          'membershipId',m.id::text,'reserveUserId',m.user_id::text,
          'tenantId',m.tenant_id::text,'membershipStatus',m.status::text,
          'tenantStatus',t.status::text)), '[]'::json)::text
        from reserve.memberships m join reserve.tenants t on t.id=m.tenant_id
        where m.user_id=${quoted(userId)} and m.tenant_id=${quoted(tenantId)}`);
      return JSON.parse(json);
    },
    async hasLiveCapability(userId, tenantId, capability) {
      if (userId !== account.id || capability !== 'tenant.read') return false;
      // This genuine PostgREST RPC enforces current Auth/session, membership,
      // tenant isolation and database capability, not client role metadata.
      const allowed = await rpc('list_setup_tenants', account.token);
      return allowed.status === 200 && Array.isArray(allowed.data) &&
        allowed.data.some(t => t.id === tenantId);
    },
  };
}
const policy = selectedTenantId => ({
  issuer, identityMode: 'shared-auth', selectedTenantId,
  requiredCapability: 'tenant.read', allowedTenantStatuses: ['SETUP'],
});
const webRequest = new Request(`${api.origin}/app?role=Owner`);
const permitted = async (account, tenantId) =>
  resolveReserveActor(webRequest, policy(tenantId), testAdapter(account));

const a = await signup('a');
const b = await signup('b', { role: 'Owner', tenant_id: randomUUID() });
const outsider = await signup('outsider', { role: 'Owner' });
const a1 = await bootstrap(a);
const a2 = await bootstrap(a);
const b1 = await bootstrap(b);
const actorA1 = await permitted(a, a1);
check(actorA1.authorized && actorA1.actor.tenantId === a1 &&
  actorA1.actor.reserveUserId === a.id, 'A may select its first real tenant');
const actorA2 = await permitted(a, a2);
check(actorA2.authorized && actorA2.actor.tenantId === a2,
  'A may select another permitted tenant with a fresh capability check');
check((await permitted(b, b1)).authorized, 'B can select its own tenant');
check(!(await permitted(a, b1)).authorized && !(await permitted(b, a1)).authorized,
  'Cross-tenant selectors fail for both owners');
check(!(await permitted(a, '')).authorized, 'No implicit tenant selection');
check(!(await permitted(outsider, a1)).authorized,
  'Forged Owner metadata without a real identity binding grants no tenant');
const adapterA = testAdapter(a);
const manager = await resolveReserveActor(webRequest,
  { ...policy(a1), requiredCapability: 'tenant.settings_manage' }, adapterA);
check(!manager.authorized, 'A route may not upgrade tenant.read into an unproven capability');
const wrongIssuer = await resolveReserveActor(webRequest,
  { ...policy(a1), issuer: 'https://other.example.invalid/auth/v1' }, adapterA);
check(!wrongIssuer.authorized, 'A configured issuer mismatch is denied');

success(await request('/auth/v1/logout?scope=global', { token: b.token }),
  'B real session revoked');
check(!(await permitted(b, b1)).authorized,
  'Revoked Auth session loses tenant access despite an otherwise valid signed JWT');
check((await permitted(a, a1)).authorized,
  'Revoking B cannot affect unrelated active A membership');
const profiles = success(await request('/rest/v1/profiles?select=id', {
  method: 'GET', token: a.token,
}), 'Website profile isolation still enforced');
check(profiles.length === 1 && profiles[0].id === a.id,
  'Reserve membership confers no Website profile access to another user');

console.log(`VENI SHARED AUTH → RESERVE ACTOR: PASS (${assertions} local bounded assertions).`);
console.log('LIMIT: Test-only server adapter; actual Reserve product routes remain unconnected and unreleased.');
