// Genuine GoTrue + PostgREST + PostgreSQL proof for the *local-only* shared
// Reserve M2.2 bootstrap conversion. Never accepts hosted URLs or credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.VENI_SHARED_BOOTSTRAP_DISPOSABLE, 'yes',
  'Explicit synthetic-only CI approval required');
const api = new URL(process.env.API_URL || 'http://invalid');
const db = new URL(process.env.DB_URL || 'postgres://invalid');
for (const [url, kinds, port] of [[api, ['http:'], '54321'], [db, ['postgres:', 'postgresql:'], '54322']]) {
  assert.ok(kinds.includes(url.protocol), 'Expected only a local Auth/SQL transport');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Loopback only');
  assert.equal(url.port, port, 'Fixed disposable local Auth stack ports');
}
assert.equal(db.pathname, '/postgres');
const key = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(key, 'Local API publishable key required');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID.test(value || '');
const q = (value) => { assert.ok(isUuid(value), 'Only synthetic validated UUIDs in SQL'); return `'${value}'::uuid`; };

function scalar(sql) {
  return execFileSync('psql', [db.href, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  }).trim();
}

async function request(path, { method = 'POST', token, body = {}, profile } = {}) {
  const headers = { apikey: key };
  if (token) headers.authorization = `Bearer ${token}`;
  else if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  if (profile) headers['Accept-Profile'] = profile;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(new URL(path, api), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const content = await res.text();
  let data = content;
  try { data = JSON.parse(content); } catch { /* no content or primitive */ }
  return { status: res.status, data };
}
const rpc = (name, token, body={}) => request(`/rest/v1/rpc/reserve_${name}`, { token, body });
const ok = (value, label) => {
  assert.ok(value.status>=200 && value.status<300,
    `${label}: HTTP ${value.status}: ${JSON.stringify(value.data).slice(0,400)}`);
  return value.data;
};
async function bootstrap(token, keyId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const answer = await rpc('bootstrap_setup_tenant', token, { request_key: keyId });
    if (['40001', '40P01', '23505'].includes(answer.data?.code)) continue;
    return answer;
  }
  throw new Error('Convergent serializable bootstrap exhausted bounded retries');
}

const label = `${Date.now()}-${randomUUID().slice(0,8)}`;
const password = `Local-${label}-Random!438`;
async function signup(name, metadata={}) {
  const account = { email: `${name}-${label}@example.invalid`, password };
  const response = await request('/auth/v1/signup', { body: {
    email: account.email, password: account.password, data: metadata,
  }});
  const data = ok(response, `signup ${name}`);
  assert.ok(isUuid(data.user?.id));
  assert.ok(data.access_token && data.refresh_token, 'Real GoTrue session required');
  return { id: data.user.id, token: data.access_token, refresh: data.refresh_token, ...account };
}

const a = await signup('bootstrap-a', { display_name: 'A, Website member' });
const b = await signup('bootstrap-b', { role: 'Owner', tenant_id: randomUUID() });
const outsider = await signup('bootstrap-outsider', { role: 'Owner', tenant_id: randomUUID() });
const failed = await signup('bootstrap-failure');

assert.equal(ok(await rpc('current_reserve_user', a.token), 'A live Reserve subject'), a.id);
assert.equal(ok(await rpc('current_reserve_user', b.token), 'B live Reserve subject'), b.id);
assert.ok((await rpc('current_reserve_user', undefined)).status>=400,
  'Anonymous must not invoke the authenticated Reserve identity RPC');
const before = Number(scalar('select count(*) from reserve.tenants;'));
assert.equal(before, 0, 'Fixture must start without Reserve tenants');
assert.deepEqual(ok(await rpc('list_setup_tenants', outsider.token), 'Outsider list'), [],
  'Untrusted metadata cannot produce a Membership');

const requestKey = randomUUID();
const raced = await Promise.all(Array.from({length:3}, () => bootstrap(a.token, requestKey)));
const ids = raced.map(res => ok(res, 'raced bootstrap').tenant_id);
assert.ok(ids.every(id => isUuid(id) && id===ids[0]), 'Concurrent idempotent creates converge');
const tenantA = ids[0];
assert.equal(scalar(`select count(*) from reserve_internal.tenant_bootstrap_requests where request_key=${q(requestKey)}`), '1');
assert.equal(scalar(`select count(*) from reserve.tenants t
  join reserve.memberships m on m.tenant_id=t.id
  join reserve.membership_roles mr on mr.membership_id=m.id
  where t.id=${q(tenantA)} and t.status='SETUP' and m.status='ACTIVE'
    and m.user_id=${q(a.id)} and mr.role_id='10000000-0000-4000-8000-000000000001'`), '1');
assert.equal(scalar(`select count(*) from reserve.audit_events where tenant_id=${q(tenantA)}
  and correlation_id=${q(requestKey)} and actor_user_id=${q(a.id)} and reason_code='BOOTSTRAP'`), '2');
assert.equal(ok(await bootstrap(a.token, requestKey), 'replayed creation').replayed, true);
assert.equal(ok(await bootstrap(b.token, requestKey), 'foreign replay').error, 'idempotency_conflict');
const tenantB = ok(await bootstrap(b.token, randomUUID()), 'B creates own tenant').tenant_id;
assert.ok(isUuid(tenantB) && tenantA!==tenantB);
const tenantA2 = ok(await bootstrap(a.token, randomUUID()), 'A creates second tenant').tenant_id;
assert.ok(isUuid(tenantA2) && tenantA2!==tenantA && tenantA2!==tenantB);

const aList = ok(await rpc('list_setup_tenants', a.token), 'A list');
const bList = ok(await rpc('list_setup_tenants', b.token), 'B list');
assert.deepEqual(aList.map(t=>t.id).sort(), [tenantA,tenantA2].sort());
assert.deepEqual(bList.map(t=>t.id), [tenantB]);
assert.ok(!aList.some(t=>t.id===tenantB), 'A cannot enumerate B tenant');
const forged = ok(await rpc('list_setup_tenants', outsider.token), 'Outsider list after creation');
assert.deepEqual(forged, []);

const settings = { target:tenantA, expected_revision:0,
  display_name:'Synthetic Veni Reserve Optometrist', timezone:'Africa/Johannesburg',
  default_locale:'en-ZA', default_currency:'ZAR',
  staff_member_singular:'Optometrist', staff_member_plural:'Optometrists' };
const first = ok(await rpc('save_tenant_business_settings', a.token, settings), 'Owner settings');
assert.equal(first.revision, 1);
assert.equal(ok(await rpc('read_tenant_business_settings', a.token, {target:tenantA}),
  'Read persisted settings').settings.display_name, settings.display_name);
assert.equal(ok(await rpc('save_tenant_business_settings', a.token, settings), 'Stale write').error,
  'revision_conflict');
assert.equal(ok(await rpc('read_tenant_business_settings', b.token, {target:tenantA}),
  'Foreign tenant read').error, 'tenant_unavailable');
assert.equal(ok(await rpc('save_tenant_business_settings', outsider.token, settings),
  'Forged owner metadata write').error, 'tenant_unavailable');

const tenantRows = async (account) => ok(await request('/rest/v1/tenants?select=id', {
  method:'GET', token:account.token, body:undefined, profile:'reserve',
}), 'Reserve Tenant RLS');
assert.deepEqual((await tenantRows(a)).map(row=>row.id).sort(), [tenantA,tenantA2].sort());
assert.deepEqual((await tenantRows(b)).map(row=>row.id), [tenantB]);
assert.deepEqual(await tenantRows(outsider), []);

// Website Profile and Arcana records still belong to the SAME canonical Auth
// UUID, and a Reserve bootstrap has not granted other Spheres' entitlements.
const websiteProfiles = ok(await request('/rest/v1/profiles?select=id', {
  method:'GET', token:a.token, body:undefined,
}), 'Website profile');
assert.deepEqual(websiteProfiles.map(row=>row.id), [a.id]);
const cards = ok(await request('/rest/v1/arcana_cards?select=id&status=eq.pilot', {
  method:'GET', token:a.token, body:undefined,
}), 'Arcana cards');
assert.ok(cards.length>0, 'Arcana pilot must remain present');
const reading = ok(await request('/rest/v1/rpc/save_arcana_single_card_reading', {
  token:a.token, body:{p_card_id:cards[0].id,p_question:'Shared account isolation?',p_note:'Synthetic.'},
}), 'Arcana journal');
assert.ok(isUuid(reading), 'Arcana write must still work');
const bReadings = ok(await request('/rest/v1/arcana_readings?select=id', {
  method:'GET', token:b.token, body:undefined,
}), 'Arcana isolation');
assert.deepEqual(bReadings, []);

// Deliberate failure in the audit insert: the entire bootstrap, its new User
// projection, Tenant, Membership and idempotency receipt must all roll back.
const failureKey = randomUUID();
scalar(`create function reserve_internal.synthetic_bootstrap_failure() returns trigger
  language plpgsql as $$ begin if new.actor_user_id=${q(failed.id)} then
   raise exception 'synthetic failure'; end if; return new; end $$;
  create trigger synthetic_bootstrap_failure before insert on reserve.audit_events
  for each row execute function reserve_internal.synthetic_bootstrap_failure();`);
try {
  const prior = scalar('select count(*) from reserve.tenants;');
  const error = await bootstrap(failed.token, failureKey);
  assert.ok(error.status>=400, 'Audit failure must reject bootstrap');
  assert.equal(scalar('select count(*) from reserve.tenants;'), prior);
  assert.equal(scalar(`select count(*) from reserve.users where id=${q(failed.id)}`), '0');
  assert.equal(scalar(`select count(*) from reserve_internal.tenant_bootstrap_requests
    where request_key=${q(failureKey)}`), '0');
} finally {
  scalar('drop trigger synthetic_bootstrap_failure on reserve.audit_events;\n' +
    'drop function reserve_internal.synthetic_bootstrap_failure();');
}

// A JWT whose refresh token was revoked must fail closed at Reserve's explicit
// live-session gate, even though website JWT policy is a separate release gate.
ok(await request('/auth/v1/logout?scope=global', {
  token:b.token, body:undefined,
}), 'B signs out');
assert.equal(ok(await rpc('current_reserve_user', b.token), 'B revoked session'), null);
assert.equal(ok(await bootstrap(b.token, randomUUID()), 'B revoked bootstrap').error,
  'unauthenticated');
assert.equal(ok(await rpc('save_tenant_business_settings', b.token, {...settings,target:tenantB}),
  'B revoked settings').error, 'unauthorized');
assert.equal(ok(await rpc('list_setup_tenants', a.token), 'A remains active').length, 2);
assert.equal(scalar('select count(*) from public.arcana_readings;'), '1',
  'Arcana journal survives subsequent Reserve bootstrap and failed transaction');
console.log('PASS: Website-authenticated Reserve bootstrap, concurrency, receipts, Owner, tenant isolation, settings, rollback, revocation and Arcana preservation');
