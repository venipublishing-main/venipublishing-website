// Integration exercise for genuine local GoTrue + PostgREST. No external deps.
// The script refuses anything except the ephemeral loopback test ports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireLoopback(name, value, port, protocols) {
  if (!value) throw new Error(`Missing ${name} for disposable local CI`);
  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol) || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.port !== String(port) || parsed.username && name === 'API_URL') {
    throw new Error(`${name} must point only at disposable local port ${port}`);
  }
  return parsed;
}

const apiBase = requireLoopback('API_URL', process.env.API_URL, 54321, ['http:']);
const dbURL = requireLoopback('DB_URL', process.env.DB_URL, 54322, ['postgres:', 'postgresql:']);
const key = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error('Missing local Supabase publishable/anon key');
if (!dbURL.pathname.endsWith('/postgres')) throw new Error('Only local postgres database permitted');

async function request(path, { method = 'GET', token, profile, body } = {}) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (profile) headers['Accept-Profile'] = profile;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(new URL(path, apiBase), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch { /* UUID or empty body is acceptable */ }
  return { status: res.status, data };
}

async function success(path, options = {}) {
  const result = await request(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Local ${path} failed (HTTP ${result.status}): ${JSON.stringify(result.data).slice(0,400)}`);
  }
  return result.data;
}

function checkIdentity(identity, name) {
  assert.match(identity.user?.id ?? '', UUID, `${name} must have real Supabase Auth UUID`);
  assert.ok(identity.access_token && identity.refresh_token, `${name} must receive a real Auth session`);
  return identity;
}

function psql(args) {
  return execFileSync('psql', [dbURL.toString(), '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', timeout: 30000, env: process.env,
  }).trim();
}

function assertRows(rows, ids, name) {
  assert.ok(Array.isArray(rows), `${name} response must be a list`);
  assert.deepEqual(rows.map((v) => v.id).sort(), ids.slice().sort(), name);
}

async function main() {
  const marker = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Local-CI!${marker}xY-42`;
  const emailA = `owner-a-${marker}@example.invalid`;
  const emailB = `owner-b-${marker}@example.invalid`;
  const emailC = `outsider-${marker}@example.invalid`;

  const signup = async (email, data) => checkIdentity(await success('/auth/v1/signup', {
    method: 'POST', body: { email, password, data },
  }), email);
  const a = await signup(emailA, { display_name: 'Owner A' });
  const b = await signup(emailB, { display_name: 'Owner B' });
  // This metadata is entirely user-editable: it must confer ZERO tenant rights.
  const c = await signup(emailC, { display_name: 'Untrusted outsider', role: 'owner', tenant_id: TENANT_A });

  psql([
    '-v', `owner_a=${a.user.id}`, '-v', `owner_b=${b.user.id}`, '-v', `outsider=${c.user.id}`,
    '-f', fileURLToPath(new URL('./real-auth-tenants.sql', import.meta.url)),
  ]);
  console.log('PASS: genuine Auth sessions, website profiles, one canonical UUID per user');

  assertRows(await success('/rest/v1/profiles?select=id', { token: a.access_token }), [a.user.id], 'Website A profile RLS');
  assertRows(await success('/rest/v1/profiles?select=id', { token: b.access_token }), [b.user.id], 'Website B profile RLS');
  assertRows(await success('/rest/v1/profiles?select=id', { token: c.access_token }), [c.user.id], 'Website outsider profile RLS');

  const reserveTenants = '/rest/v1/tenants?select=id';
  assertRows(await success(reserveTenants, { token: a.access_token, profile: 'reserve' }), [TENANT_A], 'Reserve A tenant RLS');
  assertRows(await success(reserveTenants, { token: b.access_token, profile: 'reserve' }), [TENANT_B], 'Reserve B tenant RLS');
  assertRows(await success(reserveTenants, { token: c.access_token, profile: 'reserve' }), [], 'Untrusted metadata cannot join Reserve');
  console.log('PASS: website and Reserve resolve the same Auth identities; BOLA denied');

  const cards = await success('/rest/v1/arcana_cards?select=id,slug&status=eq.pilot', { token: a.access_token });
  assert.ok(Array.isArray(cards) && cards.length >= 1, 'Arcana public pilot card unavailable');
  const reading = await success('/rest/v1/rpc/save_arcana_single_card_reading', {
    method: 'POST', token: a.access_token,
    body: { p_card_id: cards[0].id, p_question: 'Shared identity?', p_note: 'Synthetic test note.' },
  });
  assert.match(reading, UUID, 'Real Auth must save an Arcana reading');
  assertRows(await success('/rest/v1/arcana_readings?select=id', { token: a.access_token }), [reading], 'Arcana A reading');
  assertRows(await success('/rest/v1/arcana_readings?select=id', { token: b.access_token }), [], 'Arcana B cannot see A');
  console.log('PASS: Arcana write/read and cross-user isolation over PostgREST');

  const readSettings = (token, tenant) => success('/rest/v1/rpc/reserve_read_tenant_business_settings', {
    method: 'POST', token, body: { target: tenant },
  });
  assert.equal((await readSettings(a.access_token, TENANT_A)).state, 'unconfigured');
  const settings = await success('/rest/v1/rpc/reserve_save_tenant_business_settings', {
    method: 'POST', token: a.access_token,
    body: { target: TENANT_A, expected_revision: 0, display_name: 'Veni Reserve — Tenant A',
      timezone: 'Africa/Johannesburg', default_locale: 'en-ZA', default_currency: 'ZAR',
      staff_member_singular: null, staff_member_plural: null },
  });
  assert.equal(settings.state, 'configured');
  assert.equal(settings.revision, 1);
  assert.equal((await readSettings(b.access_token, TENANT_A)).error, 'tenant_unavailable');
  assert.equal((await readSettings(c.access_token, TENANT_A)).error, 'tenant_unavailable');
  const stale = await success('/rest/v1/rpc/reserve_save_tenant_business_settings', {
    method: 'POST', token: a.access_token,
    body: { target: TENANT_A, expected_revision: 0, display_name: 'Stale update',
      timezone: 'Africa/Johannesburg', default_locale: 'en-ZA', default_currency: 'ZAR',
      staff_member_singular: null, staff_member_plural: null },
  });
  assert.equal(stale.error, 'revision_conflict');
  const unauthenticated = await request('/rest/v1/rpc/reserve_read_tenant_business_settings', {
    method: 'POST', body: { target: TENANT_A },
  });
  assert.ok(unauthenticated.status === 401 || unauthenticated.status === 403,
    'Anonymous caller unexpectedly reached Reserve settings endpoint');
  console.log('PASS: tenant settings authorized; cross-tenant, stale write, and anonymous denied');

  await success('/auth/v1/logout?scope=global', { method: 'POST', token: a.access_token });
  const revokedRefresh = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: a.refresh_token },
  });
  assert.ok(revokedRefresh.status >= 400, 'Globally signed-out refresh token must be rejected');
  const staleAccess = await request('/rest/v1/rpc/reserve_read_tenant_business_settings', {
    method: 'POST', token: a.access_token, body: { target: TENANT_A },
  });
  const staleProfile = await request('/rest/v1/profiles?select=id', { token: a.access_token });
  const staleArcana = await request('/rest/v1/arcana_readings?select=id', { token: a.access_token });
  const stillAccessible = {
    reserveSettings: staleAccess.status < 400 && staleAccess.data?.state === 'configured',
    websiteProfile: staleProfile.status < 400 && Array.isArray(staleProfile.data)
      && staleProfile.data.some((row) => row.id === a.user.id),
    arcanaReading: staleArcana.status < 400 && Array.isArray(staleArcana.data)
      && staleArcana.data.some((row) => row.id === reading),
  };
  const openSurfaces = Object.entries(stillAccessible).filter(([, open]) => open).map(([name]) => name);
  if (openSurfaces.length) {
    const warning = `Previously issued access JWT still works after sign-out on: ${openSurfaces.join(', ')}. `
      + 'Block live cutover until sensitive operations have a revoked-session check and a complete cross-Sphere revocation policy.';
    console.warn(`::warning title=Veni live cutover blocked by JWT revocation gap::${warning}`);
    console.warn(`GATE OPEN: ${warning}`);
  } else {
    console.log('PASS: revoked access JWT denied every probed sensitive surface');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Real Supabase Auth/REST integration\n` +
      `- Functional tests: website, Arcana, Reserve, cross-tenant and refresh-token revocation **passed**.\n` +
      `- Access-token revocation after sign-out: **${openSurfaces.length ? 'OPEN RELEASE BLOCKER' : 'all probed operations denied'}**.\n` +
      `- Old JWT accessible surfaces: ${openSurfaces.join(', ') || 'none probed'}.\n` +
      `- Browser SSR/PKCE, account deletion and other Spheres remain untested.\n` +
      `- **Draft only; no hosted Supabase migration permitted by this result.**\n`);
  }

  // Counterfactual, not a deployed fix: apply a shared session guard ONLY to
  // the disposable local database after recording the unguarded JWT failure.
  psql(['-f', fileURLToPath(new URL('./real-auth-revocation-proof.sql', import.meta.url))]);
  const guardedSettings = await readSettings(a.access_token, TENANT_A);
  assert.equal(guardedSettings.error, 'unauthorized',
    'Experimental session guard must reject a signed-out Reserve access token');
  assertRows(await success('/rest/v1/profiles?select=id', { token: a.access_token }), [],
    'Experimental guard must hide the signed-out website profile');
  assertRows(await success('/rest/v1/arcana_readings?select=id', { token: a.access_token }), [],
    'Experimental guard must hide the signed-out Arcana reading');
  assertRows(await success(reserveTenants, { token: a.access_token, profile: 'reserve' }), [],
    'Experimental guard must hide the signed-out Reserve tenant');
  const guardedWrite = await request('/rest/v1/rpc/save_arcana_single_card_reading', {
    method: 'POST', token: a.access_token,
    body: { p_card_id: cards[0].id, p_question: 'Revoked token must fail', p_note: null },
  });
  assert.ok(guardedWrite.status >= 400, 'Revoked access token must not create a new Arcana reading');
  assertRows(await success('/rest/v1/profiles?select=id', { token: b.access_token }), [b.user.id],
    'Experimental guard must retain a different active user session');
  console.log('PROOF PASS: experimental cross-Sphere live-session gate rejects revoked JWT, retains active B');

  const relogin = checkIdentity(await success('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: emailA, password },
  }), 'Owner A second session');
  assert.equal(relogin.user.id, a.user.id, 'Re-login must preserve the canonical Veni Auth UUID');
  assert.equal((await readSettings(relogin.access_token, TENANT_A)).revision, 1,
    'Returning user must regain own Reserve tenant through the same website account');
  assertRows(await success('/rest/v1/profiles?select=id', { token: relogin.access_token }), [a.user.id],
    'New session must restore website profile access');
  assertRows(await success('/rest/v1/arcana_readings?select=id', { token: relogin.access_token }), [reading],
    'New session must restore own Arcana reading');
  assertRows(await success(reserveTenants, { token: relogin.access_token, profile: 'reserve' }), [TENANT_A],
    'New session must restore own Reserve tenant');
  console.log('PASS: refresh-token revocation, re-login, and shared identity persistence');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `- Experimental local-only session guard: **PROOF PASSED**, signed-out JWT denied across private website/Arcana/Reserve operations; new login and unrelated active session retained.\n` +
      `- The production release gate is **still OPEN**: this fixture is not a reviewed or deployed migration.\n`);
  }
  console.log('Real local Supabase Auth + PostgREST shared-backend smoke completed; SSR browser/cookie flow remains future work.');
}

await main();
