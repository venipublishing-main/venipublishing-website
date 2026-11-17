// One atomic, disposable SOURCE GoTrue + Reserve -> TARGET Website + Reserve
// migration rehearsal. Includes actual password hashes and identities, not
// mocked JWTs. No hosted project references, no production import capability.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guardedAccountDeletion } from '../../supabase/functions/_shared/delete-account-guard.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_A = 'c1111111-1111-4111-8111-111111111111';
const TENANT_B = 'c2222222-2222-4222-8222-222222222222';
const sourceSeed = fileURLToPath(new URL('./real-auth-reserve-source-business-seed.sql', import.meta.url));
const operatorScript = fileURLToPath(new URL('../../scripts/reserve-test-account-operator.mjs', import.meta.url));
const operatorReceiptSql = fileURLToPath(new URL('./reserve-test-account-operator-receipts.sql', import.meta.url));

function localUrl(name, raw, protocols) {
  assert.ok(raw, `Missing ${name}`);
  const url = new URL(raw);
  assert.ok(protocols.includes(url.protocol), `${name}: local protocol required`);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), `${name}: loopback only`);
  assert.ok(Number(url.port) >= 20000 && Number(url.port) <= 32767,
    `${name}: must be an experimental, disposable local Supabase stack port`);
  return url;
}
assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE, 'yes');
assert.equal(process.env.VENI_ATOMIC_RESERVE_REHEARSAL, 'yes');
const source = {
  api: localUrl('SOURCE_API_URL', process.env.SOURCE_API_URL, ['http:']),
  db: localUrl('SOURCE_DB_URL', process.env.SOURCE_DB_URL, ['postgres:', 'postgresql:']),
  key: process.env.SOURCE_ANON_KEY,
};
const target = {
  api: localUrl('TARGET_API_URL', process.env.TARGET_API_URL, ['http:']),
  db: localUrl('TARGET_DB_URL', process.env.TARGET_DB_URL, ['postgres:', 'postgresql:']),
  key: process.env.TARGET_ANON_KEY,
  adminKey: process.env.TARGET_SERVICE_ROLE_KEY, // disposable local Supabase stack only
};
assert.ok(source.key && target.key && target.adminKey, 'Both local Auth keys and local admin key required');
assert.notEqual(source.api.origin, target.api.origin);
assert.notEqual(source.db.port, target.db.port);
assert.equal(source.db.pathname, '/postgres');
assert.equal(target.db.pathname, '/postgres');

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function psql(db, sql, vars={}) {
  const variableArgs = Object.entries(vars).flatMap(([key, value]) => {
    assert.match(key, /^[a-z_]+$/);
    assert.match(value, UUID, 'Source user IDs must come from local GoTrue');
    return ['-v', `${key}=${value}`];
  });
  return execFileSync('psql', [db.href, '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', ...variableArgs, '-f', '-'], {
    input: sql, encoding: 'utf8', timeout: 45000, maxBuffer: 8*1024*1024,
    stdio: ['pipe','pipe','pipe'],
  }).trim();
}
function scalar(db, query) { return psql(db, query).trim(); }
function json(db, query) { return JSON.parse(scalar(db, query)); }
function csv(db, table, columns, order, where='') {
  assert.match(table, /^(auth|public|private|reserve|reserve_internal)\.[a-z_]+$/);
  const filter = where ? ` WHERE ${where}` : '';
  return psql(db, `COPY (SELECT ${columns} FROM ${table}${filter} ORDER BY ${order}) TO STDOUT WITH (FORMAT CSV, FORCE_QUOTE *);`);
}

async function request(project, path, { method='GET', token, profile, body }={}) {
  const headers = { apikey: project.key };
  if (token) headers.authorization = `Bearer ${token}`;
  else if (project.key.startsWith('eyJ')) headers.authorization = `Bearer ${project.key}`;
  if (profile) headers['Accept-Profile'] = profile;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, project.api), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function ok(project, path, args) {
  const r = await request(project, path, args);
  assert.ok(r.status>=200 && r.status<300,
    `Local HTTP ${path} status ${r.status}: ${JSON.stringify(r.data).slice(0,300)}`);
  return r.data;
}

const tag = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const website = {
  email: `website-existing-${tag}@example.invalid`,
  password: `Website-Synthetic-${tag}-28!`,
};
const actors = Object.fromEntries(['owner_a','owner_b','assistant','staff','unassigned'].map((kind) =>
  [kind, { email: `reserve-${kind.replaceAll('_','-')}-${tag}@example.invalid`,
    password: `Reserve-${kind}-${tag}-37!` }]));

async function signup(project, account, editableMetadata={}) {
  const result = await ok(project, '/auth/v1/signup', { method:'POST',
    body: { email:account.email, password:account.password,
      data:{ display_name:'Synthetic CI Account', ...editableMetadata } },
  });
  assert.match(result.user?.id ?? '',UUID);
  assert.ok(result.access_token && result.refresh_token, 'Real GoTrue session required');
  account.id=result.user.id;
  account.sourceSession=result;
  return result;
}

// Site's existing account and Arcana reading must survive the transaction.
await signup(target,website,{role:'owner',tenant_id:TENANT_A});
const originalWebsiteIdentity = website.id;
psql(target.db, `
  INSERT INTO public.entitlements(user_id,product_id)
    SELECT ${sqlLiteral(website.id)}::uuid,id FROM public.products WHERE slug='arcana-stage2-test';
  INSERT INTO public.arcana_readings(user_id,title)
    VALUES (${sqlLiteral(website.id)}::uuid,'Existing Arcana history before Reserve import');`);
assert.equal(scalar(target.db,'SELECT count(*) FROM public.arcana_readings;'),'1');

for (const [kind, account] of Object.entries(actors)) {
  await signup(source, account, kind==='unassigned'
    ? {role:'owner',tenant_id:TENANT_A} : {});
}
const seedSql = readFileSync(sourceSeed,'utf8');
psql(source.db,seedSql,Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.id])));

const manifest = [
  {from:'public.users',to:'reserve.users',cols:'id,created_at',order:'id'},
  {from:'public.tenants',to:'reserve.tenants',cols:'id,status,created_at',order:'id'},
  {from:'public.roles',to:'reserve.roles',cols:'id,kind,tenant_id,code,display_name,created_at',where:"kind='CUSTOM'",order:'id'},
  {from:'public.role_permissions',to:'reserve.role_permissions',cols:'role_id,permission_code',where:"role_id IN (SELECT id FROM public.roles WHERE kind='CUSTOM')",order:'role_id,permission_code'},
  {from:'public.memberships',to:'reserve.memberships',cols:'id,tenant_id,user_id,status,created_at',order:'id'},
  {from:'public.membership_roles',to:'reserve.membership_roles',cols:'membership_id,role_id,assigned_at',order:'membership_id,role_id'},
  // issuance_xid is local transaction provenance and must be regenerated.
  {from:'private.invitations',to:'reserve_internal.invitations',cols:'id,tenant_id,target_email,target_user_id,inviter_user_id,inviter_membership_id,created_at,expires_at,accepted_at,accepted_user_id,accepted_membership_id,revoked_at,revoked_by_membership_id,revocation_reason,supersedes_id,request_key,request_fingerprint,token_verifier',order:'id'},
  {from:'private.invitation_roles',to:'reserve_internal.invitation_roles',cols:'invitation_id,role_id',order:'invitation_id,role_id'},
  {from:'public.audit_events',to:'reserve.audit_events',cols:'id,tenant_id,occurred_at,action,category,actor_type,actor_user_id,actor_membership_id,service_actor,reason_code,target_type,target_id,correlation_id,metadata,schema_version',order:'id'},
];

function systemCatalogues() {
  const tables=[
    {src:'public.permissions',dst:'reserve.permissions',cols:'code,description',order:'code'},
    {src:'public.roles',dst:'reserve.roles',cols:'id,kind,tenant_id,code,display_name',where:"kind='SYSTEM'",order:'id'},
    {src:'public.role_permissions',dst:'reserve.role_permissions',cols:'role_id,permission_code',where:"role_id IN (SELECT id FROM public.roles WHERE kind='SYSTEM')",destWhere:"role_id IN (SELECT id FROM reserve.roles WHERE kind='SYSTEM')",order:'role_id,permission_code'},
  ];
  for(const t of tables) assert.equal(
    csv(source.db,t.src,t.cols,t.order,t.where),
    csv(target.db,t.dst,t.cols,t.order,t.destWhere||t.where),
    `System permission/role catalogue mismatch at ${t.src}`);
}

function businessCount() {
  return Number(scalar(target.db, `SELECT
     (SELECT count(*) FROM reserve.users)+
     (SELECT count(*) FROM reserve.tenants)+
     (SELECT count(*) FROM reserve.memberships)+
     (SELECT count(*) FROM reserve.membership_roles)+
     (SELECT count(*) FROM reserve.audit_events)+
     (SELECT count(*) FROM reserve.roles WHERE kind='CUSTOM')+
     (SELECT count(*) FROM reserve.role_permissions WHERE role_id IN (SELECT id FROM reserve.roles WHERE kind='CUSTOM'))+
     (SELECT count(*) FROM reserve_internal.invitations)+
     (SELECT count(*) FROM reserve_internal.invitation_roles);`));
}
function targetCount() {
  return json(target.db, `SELECT json_build_object(
    'auth',(SELECT count(*) FROM auth.users),
    'identities',(SELECT count(*) FROM auth.identities),
    'profiles',(SELECT count(*) FROM public.profiles),
    'readings',(SELECT count(*) FROM public.arcana_readings),
    'tenants',(SELECT count(*) FROM reserve.tenants),
    'memberships',(SELECT count(*) FROM reserve.memberships),
    'audit',(SELECT count(*) FROM reserve.audit_events))::text;`);
}
function authColumns(db,table) {
  const columns=json(db,`SELECT coalesce(json_agg(column_name ORDER BY ordinal_position),'[]'::json)::text
    FROM information_schema.columns WHERE table_schema='auth' AND table_name=${sqlLiteral(table)}
    AND is_generated='NEVER' AND is_identity='NO';`);
  assert.ok(columns.length>=5);
  assert.ok(columns.includes('id'));
  return columns;
}
const authUsersCols=authColumns(source.db,'users');
const authIdentCols=authColumns(source.db,'identities');
assert.deepEqual(authUsersCols,authColumns(target.db,'users'));
assert.deepEqual(authIdentCols,authColumns(target.db,'identities'));

const ids=Object.values(actors).map(a=>a.id);
const allIds=`(${ids.map(id=>`${sqlLiteral(id)}::uuid`).join(',')})`;
function sourceAuthRows(table,where) {
  return json(source.db,`SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.id),'[]'::json)::text
    FROM (SELECT * FROM auth.${table} WHERE ${where} ORDER BY id) t;`);
}
const sourceAuthUsers=sourceAuthRows('users',`id IN ${allIds}`);
const sourceAuthIdentities=sourceAuthRows('identities',`user_id IN ${allIds}`);
assert.equal(sourceAuthUsers.length,5);
assert.equal(sourceAuthIdentities.length,5);
assert.ok(sourceAuthUsers.every(u=>u.email.endsWith('@example.invalid') && u.encrypted_password));
assert.ok(sourceAuthIdentities.every(i=>ids.includes(i.user_id)));

function assertPreflight() {
  systemCatalogues();
  assert.equal(businessCount(),0,'Target Reserve already has business data');
  const existing=json(target.db,"SELECT coalesce(json_agg(json_build_object('id',id,'email',lower(btrim(email)))),'[]'::json)::text FROM auth.users;");
  const existingIds=new Set(existing.map(u=>u.id));
  const existingEmails=new Set(existing.map(u=>u.email));
  for(const user of sourceAuthUsers) {
    assert.ok(!existingIds.has(user.id),'Auth UUID collision');
    assert.ok(!existingEmails.has(user.email.trim().toLowerCase()),'Auth email collision');
  }
}

function authInsert(table,record,columns) {
  const names=columns.map(c=>{assert.match(c,/^[a-z_][a-z0-9_]*$/i);return `"${c}"`;}).join(',');
  return `INSERT INTO auth.${table} (${names}) SELECT ${names}
    FROM json_populate_record(NULL::auth.${table}, ${sqlLiteral(JSON.stringify(record))}::json);\n`;
}
function businessCopy(e) {
  const data=csv(source.db,e.from,e.cols,e.order,e.where);
  assert.ok(!data.split('\n').some(line=>line==='\\.'),'COPY framing safety');
  return `COPY ${e.to} (${e.cols}) FROM STDIN WITH (FORMAT CSV);\n${data}${data && !data.endsWith('\n')?'\n':''}\\.\n`;
}
function importScript(injectFault=false) {
  let script='\\set ON_ERROR_STOP on\nBEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n';
  for(const user of sourceAuthUsers) script+=authInsert('users',user,authUsersCols);
  for(const identity of sourceAuthIdentities) script+=authInsert('identities',identity,authIdentCols);
  for(const e of manifest) {
    if(e.to==='reserve.audit_events')script+='ALTER TABLE reserve.audit_events DISABLE TRIGGER audit_guard;\n';
    script+=businessCopy(e);
    if(e.to==='reserve.audit_events')script+='ALTER TABLE reserve.audit_events ENABLE TRIGGER audit_guard;\n';
    if(injectFault && e.to==='reserve.memberships') {
      script+='SELECT 1/0 AS deliberately_interrupted_atomic_import;\n';
      return script; // Connection closes with transaction uncommitted.
    }
  }
  return script+'COMMIT;\n';
}
function executeImport(script,fault=false) {
  const result=spawnSync('psql',[target.db.href,'-X','-q','-v','ON_ERROR_STOP=1','-f','-'],{
    input:script,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,
  });
  if(fault) {
    assert.notEqual(result.status,0,'Injected error unexpectedly committed');
    assert.match(result.stderr||'',/division by zero/i);
    assert.deepEqual(targetCount(),{auth:1,identities:1,profiles:1,readings:1,tenants:0,memberships:0,audit:0},
      'Atomic rollback must restore Website, Auth, and zero imported Reserve rows');
    assert.equal(businessCount(),0);
    console.log('PASS: injected mid-import error atomically rolled back Auth, profiles and Reserve graph');
    return;
  }
  assert.equal(result.status,0,`Integrated import failed: ${(result.stderr||'').slice(0,700)}`);
}

assertPreflight();
executeImport(importScript(true),true);
assertPreflight();
executeImport(importScript(false),false);
assert.deepEqual(targetCount(),{auth:6,identities:6,profiles:6,readings:1,tenants:2,memberships:4,audit:2});
assert.equal(businessCount(),22);
assert.equal(scalar(target.db,"SELECT tgenabled FROM pg_trigger WHERE tgrelid='reserve.audit_events'::regclass AND tgname='audit_guard';"),'O');
for(const entry of manifest) {
  const sourceRows=csv(source.db,entry.from,entry.cols,entry.order,entry.where);
  const destWhere=entry.to==='reserve.roles' ? "kind='CUSTOM'"
    : entry.to==='reserve.role_permissions' ? "role_id IN (SELECT id FROM reserve.roles WHERE kind='CUSTOM')" : '';
  assert.equal(csv(target.db,entry.to,entry.cols,entry.order,destWhere),sourceRows,
    `Historical data changed during import of ${entry.to}`);
}
systemCatalogues();
assert.throws(()=>assertPreflight(),/Target Reserve already has business data/,
  'Migration replay must be stopped before a new transaction');
console.log('PASS: identities, roles, memberships, private invitations, audit and Website Arcana history retained');

async function signin(project,account) {
  const data=await ok(project,'/auth/v1/token?grant_type=password',{
    method:'POST',body:{email:account.email,password:account.password},
  });
  assert.equal(data.user?.id,account.id,'Imported original Auth UUID must not change');
  return data.access_token;
}
const tokens={};
for(const [kind,account] of Object.entries(actors))tokens[kind]=await signin(target,account);
const websiteToken=await signin(target,website);
const crossToken=await request(target,'/auth/v1/user',{token:actors.owner_a.sourceSession.access_token});
assert.ok(crossToken.status>=400,'Old Reserve JWT cannot become a Website token');
const crossRefresh=await request(target,'/auth/v1/token?grant_type=refresh_token',{
  method:'POST',body:{refresh_token:actors.owner_a.sourceSession.refresh_token},
});
assert.ok(crossRefresh.status>=400,'Old Reserve refresh token must be rejected');

async function idsVisible(token,table,profile) {
  const rows=await ok(target,`/rest/v1/${table}?select=id`,{token,profile});
  assert.ok(Array.isArray(rows),`${table} must return a list`);
  return rows.map(r=>r.id).sort();
}
assert.deepEqual(await idsVisible(tokens.owner_a,'profiles'),[actors.owner_a.id]);
assert.deepEqual(await idsVisible(websiteToken,'profiles'),[originalWebsiteIdentity]);
assert.deepEqual(await idsVisible(tokens.owner_a,'tenants','reserve'),[TENANT_A]);
assert.deepEqual(await idsVisible(tokens.owner_b,'tenants','reserve'),[TENANT_B]);
assert.deepEqual(await idsVisible(tokens.assistant,'tenants','reserve'),[TENANT_A]);
assert.deepEqual(await idsVisible(tokens.staff,'tenants','reserve'),[TENANT_B]);
assert.deepEqual(await idsVisible(tokens.unassigned,'tenants','reserve'),[],
  'Mutable owner metadata cannot confer Reserve tenant access');
assert.deepEqual(await idsVisible(websiteToken,'tenants','reserve'),[],
  'Existing Website user cannot read Reserve tenant data');
assert.equal((await idsVisible(websiteToken,'arcana_readings')).length,1);
assert.deepEqual(await idsVisible(tokens.owner_a,'arcana_readings'),[],
  'Migrated Reserve user cannot see existing Website Arcana history');
console.log('PASS: real imported GoTrue JWTs enforce original tenant, Website and Arcana RLS');

async function deletionState(token) {
  return ok(target,'/rest/v1/rpc/reserve_account_deletion_preflight',{
    method:'POST',token,body:{},
  });
}
for(const kind of ['owner_a','owner_b'])assert.equal(await deletionState(tokens[kind]),'OWNER_TRANSFER_REQUIRED');
for(const kind of ['assistant','staff','unassigned'])assert.equal(await deletionState(tokens[kind]),'RESERVE_HISTORY_REVIEW_REQUIRED');
assert.equal(await deletionState(websiteToken),'RESERVE_CLEAR');
assert.ok((await request(target,'/rest/v1/rpc/reserve_account_deletion_preflight',{
  method:'POST',body:{},
})).status>=400,'Anonymous deletion preflight must be denied');
console.log('PASS: deletion preflight protects owners/history through genuine migrated Website sessions');

// The caller's signed JWT alone is not a live-session proof. The RPC checks
// its *own* session_id against auth.sessions through the real PostgREST API.
async function sessionLive(token) {
  return ok(target,'/rest/v1/rpc/veni_account_active_session',{
    method:'POST',token,body:{},
  });
}
for(const token of [websiteToken,...Object.values(tokens)]) {
  assert.equal(await sessionLive(token),true,'Signed-in actor must have a live session');
}
assert.ok((await request(target,'/rest/v1/rpc/veni_account_active_session',{
  method:'POST',body:{},
})).status>=400,'Anonymous clients cannot invoke privileged session lookup');
console.log('PASS: self-only active-session RPC allows genuine sessions, denies anonymous callers');

// Execute the SAME checked deletion orchestrator as the drafted Edge Function,
// against genuine disposable local GoTrue/PostgREST. No hosted API can pass
// the loopback/port guards above, and the admin key comes from local CLI.
async function attemptLocalDelete(account, token, password) {
  const calls={session:0, preflight:0, password:0, admin:0};
  const outcome=await guardedAccountDeletion({
    enabled:'enabled',
    user:{id:account.id,email:account.email},
    requestBody:{confirmation:'DELETE MY ACCOUNT',password},
    checkActiveSession:async()=>{
      calls.session++;
      const response=await request(target,'/rest/v1/rpc/veni_account_active_session',{
        method:'POST',token,body:{},
      });
      return {data:response.data,error:response.status>=200 && response.status<300 ? null : Error('local session RPC unavailable')};
    },
    runPreflight:async()=>{
      calls.preflight++;
      const response=await request(target,'/rest/v1/rpc/reserve_account_deletion_preflight',{
        method:'POST',token,body:{},
      });
      return {data:response.data,error:response.status>=200 && response.status<300 ? null : Error('local RPC unavailable')};
    },
    reauthenticate:async(email,currentPassword)=>{
      calls.password++;
      const response=await request(target,'/auth/v1/token?grant_type=password',{
        method:'POST',body:{email,password:currentPassword},
      });
      return {userId:response.data?.user?.id,hasSession:Boolean(response.data?.access_token),
        error:response.status>=200 && response.status<300 ? null : Error('local password rejected')};
    },
    deleteAuthenticatedUser:async(verifiedId)=>{
      calls.admin++;
      assert.equal(verifiedId,account.id,'Admin may only delete JWT-authenticated own UUID');
      const response=await fetch(new URL(`/auth/v1/admin/users/${verifiedId}`,target.api),{
        method:'DELETE',
        headers:{apikey:target.adminKey,authorization:`Bearer ${target.adminKey}`},
        signal:AbortSignal.timeout(25000),
      });
      return {error:response.ok ? null : Error(`local GoTrue admin returned ${response.status}`)};
    },
  });
  return {outcome,calls};
}

// Protected Reserve accounts never reach admin deletion, even with passwords.
for(const kind of ['owner_a','owner_b','staff','unassigned']) {
  const blocked=await attemptLocalDelete(actors[kind],tokens[kind],actors[kind].password);
  assert.equal(blocked.outcome.status,409,`${kind} should be blocked`);
  assert.deepEqual(blocked.calls,{session:1,preflight:1,password:0,admin:0});
}

// One newly created disposable Website-only identity can be deleted. The
// pre-existing Website account, Arcana reading and all Reserve data survive.
const disposable={email:`to-delete-${tag}@example.invalid`,password:`Delete-CI-${tag}-42!`};
await signup(target,disposable);
assert.equal(targetCount().auth,7);
assert.equal(targetCount().profiles,7);
let disposableToken=await signin(target,disposable);
assert.equal(await deletionState(disposableToken),'RESERVE_CLEAR');
const deniedPassword=await attemptLocalDelete(disposable,disposableToken,'incorrect-password');
assert.equal(deniedPassword.outcome.status,401);
assert.deepEqual(deniedPassword.calls,{session:1,preflight:1,password:1,admin:0});
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(disposable.id)};`),'1');

// Revoke the *requesting* session while keeping its signed JWT. The client can
// still present the JWT until expiry, but the account-deletion guard MUST deny
// it before asking for a password or attempting an admin operation.
const revokedClaims=JSON.parse(Buffer.from(disposableToken.split('.')[1],'base64url').toString('utf8'));
assert.equal(revokedClaims.sub,disposable.id);
assert.match(revokedClaims.session_id,UUID);
assert.equal(await sessionLive(disposableToken),true);
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.sessions WHERE id=${sqlLiteral(revokedClaims.session_id)}::uuid AND user_id=${sqlLiteral(disposable.id)}::uuid;`),'1');
psql(target.db,`DELETE FROM auth.sessions WHERE id=${sqlLiteral(revokedClaims.session_id)}::uuid AND user_id=${sqlLiteral(disposable.id)}::uuid;`);
assert.equal(await sessionLive(disposableToken),false);
const revoked=await attemptLocalDelete(disposable,disposableToken,disposable.password);
assert.equal(revoked.outcome.status,401);
assert.equal(revoked.outcome.body.code,'ACCOUNT_SESSION_NOT_ACTIVE');
assert.deepEqual(revoked.calls,{session:1,preflight:0,password:0,admin:0});
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(disposable.id)};`),'1');
disposableToken=await signin(target,disposable);
assert.equal(await sessionLive(disposableToken),true);
console.log('PASS: revoked session JWT cannot delete account; fresh login restores eligibility');

// An ordinary user JWT cannot invoke the Auth admin endpoint directly.
const deniedAdmin=await request(target,`/auth/v1/admin/users/${disposable.id}`,{
  method:'DELETE',token:disposableToken,
});
assert.ok(deniedAdmin.status===401 || deniedAdmin.status===403,
  'Supabase admin deletion must reject ordinary caller JWTs');
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(disposable.id)};`),'1');

const deleted=await attemptLocalDelete(disposable,disposableToken,disposable.password);
assert.deepEqual(deleted.outcome,{status:200,body:{deleted:true}});
assert.deepEqual(deleted.calls,{session:2,preflight:2,password:1,admin:1});
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(disposable.id)};`),'0');
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.identities WHERE user_id=${sqlLiteral(disposable.id)};`),'0');
assert.equal(scalar(target.db,`SELECT count(*) FROM public.profiles WHERE id=${sqlLiteral(disposable.id)};`),'0');
assert.deepEqual(targetCount(),{auth:6,identities:6,profiles:6,readings:1,tenants:2,memberships:4,audit:2});
assert.equal(businessCount(),22,'Deletion must preserve every Reserve business record');
assert.equal((await idsVisible(websiteToken,'arcana_readings')).length,1);
assert.ok((await request(target,'/auth/v1/token?grant_type=password',{
  method:'POST',body:{email:disposable.email,password:disposable.password},
 })).status>=400,'Deleted test account must no longer sign in');
console.log('PASS: genuine local GoTrue deleted only a synthetic Website-only account after password+Reserve gates');

// Administrator-only cleanup demonstration: Reserve projection with NO history.
// All other Reserve owner/staff identities are intentionally preserved.
psql(target.db,readFileSync(operatorReceiptSql,'utf8'));
const cleanupFixture={
  email:`reserve-operator-cleanup-${tag}@example.invalid`,
  password:`ReserveOperator-${tag}-47!`,
};
await signup(target,cleanupFixture,
  {veni_synthetic_fixture:tag,role:'owner'}); // mutable metadata is NOT trusted
psql(target.db,`UPDATE auth.users
  SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb) ||
    jsonb_build_object('veni_synthetic_fixture',${sqlLiteral(tag)})
  WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;
  INSERT INTO reserve.users(id) VALUES (${sqlLiteral(cleanupFixture.id)}::uuid);`);
assert.equal(targetCount().auth,7);
assert.equal(scalar(target.db,`SELECT count(*) FROM reserve.users WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;`),'1');

const operatorEnv={...process.env,CI:'true',
  VENI_ATOMIC_RESERVE_REHEARSAL:'yes',VENI_SYNTHETIC_CLEANUP_TEST_ONLY:'yes',
  VENI_SYNTHETIC_OPERATOR_ID:'ci:reserve-rehearsal-runner',
  TARGET_DB_URL:target.db.href,TARGET_API_URL:target.api.href,
  TARGET_SERVICE_ROLE_KEY:target.adminKey,
};
function runOperator(account,mode,extra=[]) {
  const args=[operatorScript,mode,'--account-id',account.id,
    '--email',account.email,'--fixture',tag,...extra];
  const result=spawnSync(process.execPath,args,{
    env:operatorEnv,encoding:'utf8',timeout:90000,maxBuffer:1024*1024,
  });
  assert.ok([0,2].includes(result.status),
    `Local-only operator unexpectedly failed: ${(result.stderr||'').slice(-400)}`);
  const output=(result.stdout||'').trim().split('\n').at(-1);
  const parsed=JSON.parse(output);
  return {exit:result.status,...parsed};
}
const ownerOperatorPlan=runOperator(actors.owner_a,'--plan');
assert.equal(ownerOperatorPlan.status,'BLOCKED');
assert.ok(ownerOperatorPlan.reasons.some(x=>x.startsWith('PROTECTED_REFERENCE:')));
const unmarkedOperatorPlan=runOperator(actors.unassigned,'--plan');
assert.equal(unmarkedOperatorPlan.status,'BLOCKED');
assert.ok(unmarkedOperatorPlan.reasons.includes('TRUSTED_FIXTURE_MARKER_MISSING'));
const operatorPlan=runOperator(cleanupFixture,'--plan');
assert.equal(operatorPlan.status,'ELIGIBLE');
assert.equal(operatorPlan.impact.reserveProjections,1);
assert.equal(operatorPlan.impact.membershipsOrAuditRemoved,0);

const operatorReason='Disposable unassigned Reserve identity created by this isolated CI run';
const wrongApproval=runOperator(cleanupFixture,'--execute',[
  '--approve-hash','0'.repeat(64),
  '--confirm',`DELETE TEST ACCOUNT ${cleanupFixture.id}`,
  '--reason',operatorReason,
]);
assert.equal(wrongApproval.exit,2);
assert.equal(wrongApproval.status,'DENIED');
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;`),'1');

const operatorResult=runOperator(cleanupFixture,'--execute',[
  '--approve-hash',operatorPlan.sha256,
  '--confirm',`DELETE TEST ACCOUNT ${cleanupFixture.id}`,
  '--reason',operatorReason,
]);
assert.equal(operatorResult.status,'DELETED');
assert.equal(scalar(target.db,`SELECT count(*) FROM auth.users WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;`),'0');
assert.equal(scalar(target.db,`SELECT count(*) FROM reserve.users WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;`),'0');
assert.equal(scalar(target.db,`SELECT count(*) FROM public.profiles WHERE id=${sqlLiteral(cleanupFixture.id)}::uuid;`),'0');
assert.deepEqual(targetCount(),{auth:6,identities:6,profiles:6,readings:1,tenants:2,memberships:4,audit:2});
assert.equal(businessCount(),22,'Operator cleanup must not change Reserve business/history graph');
assert.equal(scalar(target.db,`SELECT count(*) FROM venicleanup_ci.receipts;`),'3');
assert.equal(scalar(target.db,`SELECT count(*) FROM venicleanup_ci.receipts WHERE outcome='SUCCEEDED';`),'1');
assert.equal(scalar(target.db,`SELECT count(*) FROM venicleanup_ci.receipts WHERE outcome='DENIED';`),'1');
assert.throws(()=>psql(target.db,`UPDATE venicleanup_ci.receipts SET reason='tampered';`),
  /Synthetic cleanup evidence is append-only|command failed|psql/);
assert.throws(()=>psql(target.db,`DELETE FROM venicleanup_ci.receipts;`),
  /Synthetic cleanup evidence is append-only|command failed|psql/);
assert.equal(scalar(target.db,'SELECT count(*) FROM venicleanup_ci.receipts;'),'3');
console.log('PASS: operator dry-run, forged metadata denial, approval digest, unassigned synthetic deletion and immutable receipt audit');

assert.equal(scalar(source.db,'SELECT count(*) FROM auth.users;'),'5');
assert.equal(scalar(source.db,'SELECT count(*) FROM public.tenants;'),'2');
assert.equal(scalar(source.db,'SELECT count(*) FROM public.audit_events;'),'2');
console.log('PASS: source Reserve unchanged, all 5 imported passwords work without resets; target has 1 original Website account');
if (process.env.VENI_EXPORT_SYNTHETIC_RECOVERY_ACCOUNTS === 'yes') {
  assert.equal(process.env.VENI_CROSS_CLUSTER_RECOVERY,'yes');
  const path=process.env.VENI_SYNTHETIC_RECOVERY_ACCOUNTS_FILE;
  assert.ok(path && process.env.RUNNER_TEMP &&
    path.startsWith(`${process.env.RUNNER_TEMP}/veni-recovery-`),
  'Only a runner-temporary file may hold synthetic recovery credentials');
  const safeAccount=(entry)=>({id:entry.id,email:entry.email,password:entry.password});
  writeFileSync(path,JSON.stringify({
    website:safeAccount(website),
    reserve:Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,safeAccount(a)])),
    oldTargetToken:tokens.owner_a,
  }),{mode:0o600,flag:'wx'});
  console.log('PASS: ephemeral synthetic-only recovery credential fixture prepared for isolated CI');
}
console.log('GATE OPEN: actual booking tables, live-provider configuration, backup/restore and hosted cutover remain untested');
