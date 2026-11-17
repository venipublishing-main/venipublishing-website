// Genuine Supabase GoTrue + PostgREST proof for the shared Website/Reserve DB.
// Disposable loopback stack and @example.invalid test identities ONLY.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localUrl(name, url, port, protocols) {
  if (!url) throw new Error(`Missing local ${name}`);
  const value = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(value.hostname) ||
      value.port !== String(port) || !protocols.includes(value.protocol)) {
    throw new Error(`Refusing ${name}: only loopback:${port} is allowed`);
  }
  return value;
}

const api = localUrl('API_URL', process.env.API_URL, 56321, ['http:']);
const db = localUrl('DB_URL', process.env.DB_URL, 56322, ['postgres:', 'postgresql:']);
if (db.pathname !== '/postgres' || api.username || api.password) throw new Error('Invalid local test endpoint');
const key = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error('Missing disposable API key');

async function call(path, token, body, options = {}) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.profile) headers['Accept-Profile'] = options.profile;
  const response = await fetch(new URL(path, api), {
    method: options.method || (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data };
}

async function ok(path, token, body, options) {
  const response = await call(path, token, body, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(response.data).slice(0,250)}`);
  }
  return response.data;
}

function psql(sqlFile, variables = []) {
  return execFileSync('psql', [db.toString(), '-X', '-v', 'ON_ERROR_STOP=1', ...variables,
    ...(sqlFile ? ['-f', sqlFile] : [])], { encoding: 'utf8', timeout: 30000, env: process.env });
}

const location = { name: 'Synthetic main branch', kind: 'PHYSICAL', description: null,
  timezone_override: null, public_visible: true, sort_order: 0, status: 'ACTIVE' };
const service = { name: 'Synthetic eye consultation', description: null, category: null,
  duration_minutes: 45, price_minor_units: 45000, currency_override: 'ZAR',
  price_display: 'AMOUNT', buffer_before_minutes: 5, buffer_after_minutes: 10,
  min_notice_minutes: null, max_advance_days: null, public_visible: true,
  online_bookable: true, sort_order: 0, status: 'ACTIVE' };
const staff = { name: 'Dr Synthetic', public_display_name: 'Dr S', biography: null,
  status: 'ACTIVE', public_visible: false, online_bookable: true,
  no_preference_eligible: true, sort_order: 0 };
const eligibility = (kind, staffId, serviceId, locationId) => ({
  kind, staff_id: staffId, service_id: serviceId, location_id: locationId,
  enabled: true, duration_override_minutes: null, price_override_minor_units: null,
  buffer_before_override_minutes: null, buffer_after_override_minutes: null,
  online_bookable_override: null,
});

async function main() {
  const random = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Local-Test!${random}Xz`;
  const signup = async (name, metadata = {}) => {
    const result = await ok('/auth/v1/signup', null, {
      email: `${name}-${random}@example.invalid`, password, data: metadata,
    });
    assert.match(result.user?.id ?? '', UUID);
    assert.ok(result.access_token && result.refresh_token);
    return result;
  };
  const a = await signup('owner-a');
  const b = await signup('owner-b');
  const outsider = await signup('outsider', { role: 'owner', tenant_id: TENANT_A });
  psql(fileURLToPath(new URL('./real-auth-tenants.sql', import.meta.url)), [
    '-v', `owner_a=${a.user.id}`, '-v', `owner_b=${b.user.id}`, '-v', `outsider=${outsider.user.id}`,
  ]);

  const rpc = (name, token, body) => ok(`/rest/v1/rpc/reserve_${name}`, token, body);
  const list = (kind, token, target = TENANT_A) => rpc(`list_tenant_${kind}`, token, { target });
  const save = (kind, token, target, idName, id, expected, attributes) =>
    rpc(`save_tenant_${kind}`, token, { target, [idName]: id, expected, attributes });

  assert.equal((await list('locations', a.access_token)).locations.length, 0);
  assert.equal((await list('services', a.access_token)).services.length, 0);
  assert.equal((await list('staff', a.access_token)).staff.length, 0);
  assert.equal((await list('eligibility', a.access_token)).eligibility.length, 0);
  assert.equal((await list('staff', b.access_token)).error, 'tenant_unavailable');
  assert.equal((await list('staff', outsider.access_token)).error, 'tenant_unavailable');

  const loc = await save('location', a.access_token, TENANT_A, 'location', null, 0, location);
  const svc = await save('service', a.access_token, TENANT_A, 'service', null, 0, service);
  const person = await save('staff', a.access_token, TENANT_A, 'staff', null, 0, staff);
  for (const result of [loc, svc, person]) assert.equal(result.revision, 1, JSON.stringify(result));
  assert.match(loc.location_id, UUID);
  assert.match(svc.service_id, UUID);
  assert.match(person.staff_id, UUID);
  const links = [
    eligibility('STAFF_SERVICE', person.staff_id, svc.service_id, null),
    eligibility('STAFF_LOCATION', person.staff_id, null, loc.location_id),
    eligibility('SERVICE_LOCATION', null, svc.service_id, loc.location_id),
  ];
  const stored = [];
  for (const attributes of links) {
    const result = await save('eligibility', a.access_token, TENANT_A, 'link', null, 0, attributes);
    assert.equal(result.revision, 1, JSON.stringify(result));
    assert.match(result.eligibility_id, UUID);
    stored.push(result.eligibility_id);
  }
  assert.equal((await list('locations', a.access_token)).locations.length, 1);
  assert.equal((await list('services', a.access_token)).services.length, 1);
  assert.equal((await list('staff', a.access_token)).staff.length, 1);
  assert.equal((await list('eligibility', a.access_token)).eligibility.length, 3);

  const changedStaff = await save('staff', a.access_token, TENANT_A, 'staff', person.staff_id, 1,
    { ...staff, biography: 'A fictional professional' });
  assert.equal(changedStaff.revision, 2, JSON.stringify(changedStaff));
  assert.equal((await save('staff', a.access_token, TENANT_A, 'staff', person.staff_id, 1, staff)).error,
    'revision_conflict');
  const changed = await save('eligibility', a.access_token, TENANT_A, 'link', stored[0], 1,
    { ...links[0], duration_override_minutes: 60, online_bookable_override: false });
  assert.equal(changed.revision, 2, JSON.stringify(changed));
  assert.equal((await save('eligibility', a.access_token, TENANT_A, 'link', stored[0], 1, links[0])).error,
    'revision_conflict');
  assert.equal((await save('staff', b.access_token, TENANT_B, 'staff', person.staff_id, 1, staff)).error,
    'staff_unavailable');
  assert.equal((await save('location', outsider.access_token, TENANT_A, 'location', null, 0, location)).error,
    'tenant_unavailable');

  // A signed-in Website principal must not acquire a Reserve Membership merely
  // through user-editable Auth metadata. All Reserve tables remain unexposed.
  const profile = await ok('/rest/v1/profiles?select=id', a.access_token);
  assert.deepEqual(profile.map(record => record.id), [a.user.id]);
  const cards = await ok('/rest/v1/arcana_cards?select=id&status=eq.pilot', a.access_token);
  assert.ok(Array.isArray(cards) && cards.length >= 1);
  for (const table of ['locations', 'services', 'staff_members', 'eligibility_links']) {
    const publicResult = await call(`/rest/v1/${table}?select=id`, a.access_token);
    assert.ok(publicResult.status >= 400, `${table} wrongly exposed in public`);
    const privateResult = await call(`/rest/v1/${table}?select=id`, a.access_token, undefined,
      { profile: 'reserve_internal' });
    assert.equal(privateResult.status, 406, `${table} private schema exposed`);
  }

  // Check every database row and event journal survived the API round trip;
  // ensure no shadow Auth account was created for a Staff profile.
  psql(fileURLToPath(new URL('./reserve-shared-m2-catalogue-verify.sql', import.meta.url)), [
    '-v', `owner_a=${a.user.id}`, '-v', `outsider=${outsider.user.id}`,
  ]);
  await ok('/auth/v1/logout?scope=global', a.access_token, undefined, { method: 'POST' });
  assert.equal((await list('staff', a.access_token)).error, 'unauthorized');
  console.log('PASS: One Website Auth owner, separate Reserve tenant/Staff/Service/Location/eligibility; eight private relations and full RLS boundaries');
}

await main();
