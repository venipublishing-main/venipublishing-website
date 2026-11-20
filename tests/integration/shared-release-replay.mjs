// Run once on a fresh, unlinked release fixture after the historical migrations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [fixture, reserveCheckout] = process.argv.slice(2).map(p => resolve(p));
const config = readFileSync(join(fixture, 'supabase/config.toml'), 'utf8');
assert.match(config, /^project_id = "veni_shared_release_1120"$/m);
const cli = join(reserveCheckout, 'node_modules/supabase/dist/supabase.js');
const { authorizeClient } = await import(pathToFileURL(join(reserveCheckout, 'local/onboarding-oauth.mjs')));
const runCli = (...args) => execFileSync(process.execPath, [cli, ...args, '--workdir', fixture],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const state = JSON.parse(runCli('status', '-o', 'json'));
const origin = 'http://127.0.0.1:57421';
assert.equal(state.API_URL, origin);
const sql = input => execFileSync('docker', ['exec', '-i', 'supabase_db_veni_shared_release_1120',
  'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8' }).trim();
assert.equal(sql("select to_regnamespace('veni_account_entitlements') is null"), 't');
const auth = (path, init = {}) => {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  return fetch(url, { ...init, redirect: 'manual', headers: { apikey: state.PUBLISHABLE_KEY, ...init.headers } });
};
const bearer = token => ({ Authorization: 'Bearer '+token });
const post = (path, body, headers) => auth(path, { method: 'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
async function ok(response, label) { assert.ok(response.ok, label+' HTTP '+response.status); return response.json(); }
const user = await ok(await post('/auth/v1/signup', { email: randomUUID()+'@example.invalid', password: randomUUID()+'aA!' }), 'signup');
const callback = 'https://vf-reserve-stg.veni-reserve.workers.dev/auth/veni/callback';
// The helper parses the redirect URI. All requests, including code exchange, use the local issuer.
const client = await ok(await post('/auth/v1/admin/oauth/clients', {name:'Synthetic Reserve fixture', redirect_uris:[callback],
  client_type:'confidential', token_endpoint_auth_method:'client_secret_basic'}, { ...bearer(state.SERVICE_ROLE_KEY), apikey:state.SERVICE_ROLE_KEY }), 'register');
assert.match(client.client_id, /^[a-f0-9-]{36}$/);
const publicId = '708f2b73-1c2c-4565-bf94-4325c4af0d31';
sql("update auth.oauth_clients set id='"+publicId+"' where id='"+client.client_id+"'");
client.client_id = publicId;
const r = await authorizeClient({auth, ok, client, token:user.access_token, callback});
const rpc = async (name, body, token=r.access) => ok(await post('/rest/v1/rpc/reserve_'+name,body,bearer(token)),name);
const first = (await rpc('bootstrap_setup_tenant',{request_key:randomUUID()})).tenant_id;
assert.match(first, /^[a-f0-9-]{36}$/);
const website = async token => {
  const rows = await ok(await auth('/rest/v1/profiles?select=id',{headers:bearer(token)}),'Website profile');
  assert.deepEqual(rows.map(p=>p.id),[user.user.id]);
};
await website(user.access_token);

const ledger = fileURLToPath(new URL('../../supabase/migrations/',import.meta.url));
const pending = readdirSync(ledger).filter(name=>/^202611(19|20)\d{6}_.*\.sql$/.test(name)).sort();
assert.equal(pending.length,5);
for (const name of pending) copyFileSync(join(ledger,name),join(fixture,'supabase/migrations',name));
runCli('migration','up','--local');
await website(user.access_token);
assert.deepEqual((await rpc('list_setup_tenants',{})).map(t=>t.id),[first]);
assert.equal((await rpc('current_reserve_user',{},user.access_token)),null);
const rotated = await ok(await post('/auth/v1/token?grant_type=refresh_token',{refresh_token:user.refresh_token}),'Website refresh');
await website(rotated.access_token);
assert.equal(await ok(await post('/rest/v1/rpc/veni_account_is_direct_session',{},bearer(rotated.access_token)),'Account session'),true);
assert.equal(await ok(await post('/rest/v1/rpc/veni_account_is_direct_session',{},bearer(r.access)),'delegated session'),false);
console.log('PASS five forward migrations with existing Website and Reserve sessions; atomic Reserve classification and Website refresh');

const second = (await rpc('bootstrap_setup_tenant',{request_key:randomUUID()})).tenant_id;
assert.match(second,/^[a-f0-9-]{36}$/);
assert.notEqual(first,second);
const decision = async business => (await rpc('read_publish_entitlement',{target:business})).entitled;
assert.equal(await decision(first),false);
const org=randomUUID(), unrelated=randomUUID();
sql(`insert into veni_account_entitlements.organizations values ('${org}'),('${unrelated}');
  insert into veni_account_entitlements.reserve_businesses values ('${first}','${org}'),('${second}','${org}')`);
for (const basis of ['subscription','free_pilot']) {
  const id=randomUUID();
  const grant=(organization) => `insert into veni_account_entitlements.reserve_publish_grants
    values ('${id}','${first}','${organization}','${basis}',now()-interval '1 hour',now()+interval '1 hour',null)`;
  assert.throws(()=>sql(grant(unrelated)), /foreign key/);
  sql(grant(org));
  assert.equal(await decision(first),true);
  assert.equal(await decision(second),false);
  sql(`update veni_account_entitlements.reserve_publish_grants set valid_from=now()+interval '5 minutes' where decision_id='${id}'`);
  assert.equal(await decision(first),false);
  sql(`update veni_account_entitlements.reserve_publish_grants set valid_from=now()-interval '2 hours',expires_at=now()-interval '1 hour' where decision_id='${id}'`);
  assert.equal(await decision(first),false);
  sql(`update veni_account_entitlements.reserve_publish_grants set expires_at=now()+interval '1 hour',revoked_at=now() where decision_id='${id}'`);
  assert.equal(await decision(first),false);
}
assert.equal(sql(`select bool_or(has_schema_privilege(r,'veni_account_entitlements','usage') or
  has_table_privilege(r,'veni_account_entitlements.reserve_publish_grants','select,insert,update,delete') or
  has_function_privilege(r,'reserve_internal.account_publish_entitlement(uuid)','execute'))
  from unnest(array['anon','authenticated','performance_api','service_role']) r`),'f');
console.log('PASS authoritative exact-business scope for one owner and organization with two businesses, both grant bases, time bounds, revoked decisions, rejected foreign binding and private ACLs');
