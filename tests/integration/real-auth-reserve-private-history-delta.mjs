// Synthetic-only M2.1/M2.2/M7 delta, following the real GoTrue M1 transfer.
// SOURCE is an independent disposable Reserve service; TARGET is a separate
// disposable Website + Arcana + Reserve service. NEVER point at hosted URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for (const flag of ['VENI_DUAL_AUTH_DISPOSABLE','VENI_ATOMIC_RESERVE_REHEARSAL',
  'VENI_CROSS_CLUSTER_RECOVERY','VENI_PRIVATE_HISTORY_DELTA_DISPOSABLE']) {
  assert.equal(process.env[flag],'yes','Missing local-only gate: '+flag);
}
function localUrl(name,raw,protocols,path) {
  assert.ok(raw,name+' required');
  const u=new URL(raw);
  assert.ok(protocols.includes(u.protocol),name+' protocol');
  assert.ok(['localhost','127.0.0.1'].includes(u.hostname),name+' loopback only');
  assert.ok(+u.port>=20000 && +u.port<=32767,name+' CI port');
  assert.equal(u.pathname,path);
  return u;
}
const source={
  api:localUrl('SOURCE_API_URL',process.env.SOURCE_API_URL,['http:'],'/'),
  db:localUrl('SOURCE_DB_URL',process.env.SOURCE_DB_URL,['postgres:','postgresql:'],'/postgres'),
  key:process.env.SOURCE_ANON_KEY,
};
const target={
  api:localUrl('TARGET_API_URL',process.env.TARGET_API_URL,['http:'],'/'),
  db:localUrl('TARGET_DB_URL',process.env.TARGET_DB_URL,['postgres:','postgresql:'],'/postgres'),
  key:process.env.TARGET_ANON_KEY,
};
assert.notEqual(source.api.port,target.api.port);
assert.notEqual(source.db.port,target.db.port);
assert.ok(source.key && target.key);
const fixturePath=process.env.VENI_SYNTHETIC_RECOVERY_ACCOUNTS_FILE;
assert.ok(process.env.RUNNER_TEMP && fixturePath?.startsWith(
  process.env.RUNNER_TEMP+'/veni-recovery-'),'Synthetic runner-only accounts required');
const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_A='c1111111-1111-4111-8111-111111111111';
for (const a of [fixture.website,...Object.values(fixture.reserve)]) {
  assert.match(a.id,UUID);
  assert.ok(a.email.endsWith('@example.invalid') && a.password.length>=16);
}
function uuid(value) {
  assert.match(value,UUID);
  return "'"+value+"'::uuid";
}
function psql(db,sql) {
  return execFileSync('psql',[db.href,'-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-f','-'],{
    input:sql,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024,
    stdio:['pipe','pipe','pipe'],
  }).trim();
}
function scalar(db,sql) { return psql(db,sql); }
function count(db,relation) {
  assert.match(relation,/^(public|private|reserve|reserve_internal|auth)\.[a-z_]+$/);
  return Number(scalar(db,'SELECT count(*) FROM '+relation+';'));
}
async function request(project,path,token,body) {
  const headers={apikey:project.key,'content-type':'application/json'};
  if(token) headers.authorization='Bearer '+token;
  else if(project.key.startsWith('eyJ')) headers.authorization='Bearer '+project.key;
  const response=await fetch(new URL(path,project.api),{
    method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(25000),
  });
  const data=await response.json().catch(()=>null);
  assert.ok(response.status>=200 && response.status<300,
    path+' HTTP '+response.status+' '+JSON.stringify(data).slice(0,250));
  return data;
}
async function login(project,account) {
  const data=await request(project,'/auth/v1/token?grant_type=password',null,
    {email:account.email,password:account.password});
  assert.equal(data.user?.id,account.id);
  assert.ok(data.access_token);
  return data.access_token;
}
async function rpc(project,name,token,body) {
  return request(project,'/rest/v1/rpc/'+name,token,body);
}

// A real SOURCE session makes a genuinely idempotent tenant-bootstrap receipt.
const sourceUnassigned=await login(source,fixture.reserve.unassigned);
const sourceOwner=await login(source,fixture.reserve.owner_a);
const key=randomUUID();
const setup=await rpc(source,'bootstrap_setup_tenant',sourceUnassigned,{request_key:key});
assert.match(setup.tenant_id,UUID);
assert.match(setup.membership_id,UUID);
assert.equal(setup.replayed,false);
const replay=await rpc(source,'bootstrap_setup_tenant',sourceUnassigned,{request_key:key});
assert.deepEqual(replay,{tenant_id:setup.tenant_id,membership_id:setup.membership_id,replayed:true});
assert.equal(count(source.db,'private.tenant_bootstrap_requests'),1);
assert.equal(count(source.db,'public.tenants'),3);

const settings=(tenant,display)=>({
  target:tenant,expected_revision:0,display_name:display,
  timezone:'Africa/Johannesburg',default_locale:'en-ZA',
  default_currency:'ZAR',staff_member_singular:'Optometrist',
  staff_member_plural:'Optometrists',
});
assert.equal((await rpc(source,'save_tenant_business_settings',sourceOwner,
  settings(TENANT_A,'VVB Synthetic Optometrist'))).revision,1);
assert.equal((await rpc(source,'save_tenant_business_settings',sourceUnassigned,
  settings(setup.tenant_id,'New Synthetic Reserve Practice'))).revision,1);

const originalTokens={primary:'#AABBCC',accent:'#334455',typography:'serif'};
const revisedTokens={primary:'#112233',accent:'#445566',typography:'system'};
const createdA=await rpc(source,'create_tenant_theme',sourceOwner,{
  target:TENANT_A,theme_name:'VVB Private Theme',design_tokens:originalTokens,
});
assert.match(createdA.theme_id,UUID);
assert.equal(createdA.current_revision,1);
const savedA=await rpc(source,'save_tenant_theme_revision',sourceOwner,{
  target:TENANT_A,theme:createdA.theme_id,expected:1,design_tokens:revisedTokens,
});
assert.equal(savedA.current_revision,2);
const createdC=await rpc(source,'create_tenant_theme',sourceUnassigned,{
  target:setup.tenant_id,theme_name:'New Practice Private Theme',design_tokens:originalTokens,
});
assert.match(createdC.theme_id,UUID);
assert.equal(count(source.db,'private.themes'),2);
assert.equal(count(source.db,'private.theme_revisions'),3);
assert.equal(count(source.db,'private.theme_revision_events'),3);
assert.equal(count(source.db,'private.published_theme_assignments'),0);
console.log('PASS: real SOURCE GoTrue created replay-safe receipt, two settings snapshots, and three immutable Theme revisions');

const tenantWhere='tenant_id='+uuid(setup.tenant_id);
const membershipWhere='membership_id='+uuid(setup.membership_id);
const settingWhere='tenant_id IN ('+uuid(TENANT_A)+','+uuid(setup.tenant_id)+')';
const manifest=[
  {from:'public.tenants',to:'reserve.tenants',
    cols:'id,status,created_at',order:'id',where:'id='+uuid(setup.tenant_id)},
  {from:'public.memberships',to:'reserve.memberships',
    cols:'id,tenant_id,user_id,status,created_at',order:'id',where:tenantWhere},
  {from:'public.membership_roles',to:'reserve.membership_roles',
    cols:'membership_id,role_id,assigned_at',order:'membership_id,role_id',where:membershipWhere},
  {from:'public.audit_events',to:'reserve.audit_events',
    cols:'id,tenant_id,occurred_at,action,category,actor_type,actor_user_id,actor_membership_id,service_actor,reason_code,target_type,target_id,correlation_id,metadata,schema_version',
    order:'id',where:tenantWhere},
  {from:'private.tenant_bootstrap_requests',to:'reserve_internal.tenant_bootstrap_requests',
    cols:'request_key,user_id,tenant_id,membership_id,operation,created_at',
    order:'request_key',where:'request_key='+uuid(key)},
  {from:'private.tenant_business_settings',to:'reserve_internal.tenant_business_settings',
    cols:'tenant_id,display_name,timezone,default_locale,default_currency,staff_member_singular,staff_member_plural,revision,created_at,updated_at',
    order:'tenant_id',where:settingWhere},
  {from:'private.tenant_business_settings_changes',to:'reserve_internal.tenant_business_settings_changes',
    cols:'tenant_id,revision,action,occurred_at,actor_user_id,actor_membership_id',
    order:'tenant_id,revision',where:settingWhere},
  {from:'private.themes',to:'reserve_internal.themes',
    cols:'id,tenant_id,name,status,draft_revision,created_by_user_id,created_by_membership_id,created_at,updated_at',
    order:'id',where:''},
  {from:'private.theme_revisions',to:'reserve_internal.theme_revisions',
    cols:'id,tenant_id,theme_id,revision,schema_version,tokens,source_revision,actor_user_id,actor_membership_id,created_at',
    order:'tenant_id,theme_id,revision',where:''},
  {from:'private.theme_revision_events',to:'reserve_internal.theme_revision_events',
    cols:'id,tenant_id,theme_id,revision,action,actor_user_id,actor_membership_id,occurred_at,correlation_id',
    order:'tenant_id,theme_id,revision',where:''},
];
function sourceCsv(db,relation,cols,order,where) {
  assert.match(relation,/^(public|private|reserve|reserve_internal)\.[a-z_]+$/);
  assert.match(cols,/^[a-z_,]+$/);
  const statement='COPY (SELECT '+cols+' FROM '+relation+
    (where?' WHERE '+where:'')+' ORDER BY '+order+
    ') TO STDOUT WITH (FORMAT CSV, FORCE_QUOTE *);';
  return psql(db,statement);
}
const snapshotRelations=[
  'auth.users','auth.identities','public.profiles','public.arcana_readings',
  'reserve.tenants','reserve.memberships','reserve.membership_roles','reserve.audit_events',
  'reserve_internal.tenant_bootstrap_requests','reserve_internal.tenant_business_settings',
  'reserve_internal.tenant_business_settings_changes','reserve_internal.themes',
  'reserve_internal.theme_revisions','reserve_internal.theme_revision_events',
  'reserve_internal.published_theme_assignments',
];
function snapshot() {
  return snapshotRelations.map(name=>[name,count(target.db,name)]);
}
const baseline=snapshot();
assert.equal(count(target.db,'reserve.tenants'),2);
for (const table of [
  'tenant_bootstrap_requests','tenant_business_settings','tenant_business_settings_changes',
  'themes','theme_revisions','theme_revision_events','published_theme_assignments',
]) assert.equal(count(target.db,'reserve_internal.'+table),0,'Target private data preflight');
const sourceCopies=manifest.map(m=>sourceCsv(source.db,m.from,m.cols,m.order,m.where));
function transfer(fault) {
  let sql='\\set ON_ERROR_STOP on\nBEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n';
  for(let i=0;i<manifest.length;i++){
    const m=manifest[i],data=sourceCopies[i];
    assert.ok(!data.split('\n').includes('\\.'),'No COPY framing escapes');
    if(m.to==='reserve.audit_events') sql+='ALTER TABLE reserve.audit_events DISABLE TRIGGER audit_guard;\n';
    sql+='COPY '+m.to+' ('+m.cols+') FROM STDIN WITH (FORMAT CSV);\n'+
      data+(data&&!data.endsWith('\n')?'\n':'')+'\\.\n';
    if(m.to==='reserve.audit_events') sql+='ALTER TABLE reserve.audit_events ENABLE TRIGGER audit_guard;\n';
    if(fault && m.to==='reserve_internal.theme_revisions') {
      sql+='SELECT 1/0 AS synthetic_atomic_rollback;\n';
      return sql;
    }
  }
  return sql+'COMMIT;\n';
}
function execute(sql,expectFailure) {
  const result=spawnSync('psql',[target.db.href,'-X','-q','-v','ON_ERROR_STOP=1','-f','-'],{
    input:sql,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,
  });
  if(expectFailure) {
    assert.notEqual(result.status,0,'Injected failure must abort import');
    assert.match(result.stderr||'',/division by zero/i);
    assert.deepEqual(snapshot(),baseline,'Abort must roll back every new Theme and receipt row');
  } else {
    assert.equal(result.status,0,'Private-history import: '+(result.stderr||'').slice(-700));
  }
}
execute(transfer(true),true);
execute(transfer(false),false);
for (let i=0;i<manifest.length;i++){
  const m=manifest[i];
  const result=sourceCsv(target.db,m.to,m.cols,m.order,m.where);
  assert.equal(result,sourceCopies[i],'Changed historical bytes in '+m.to);
}
assert.equal(count(target.db,'reserve.tenants'),3);
assert.equal(count(target.db,'reserve.memberships'),5);
assert.equal(count(target.db,'reserve.audit_events'),4);
assert.equal(count(target.db,'reserve_internal.tenant_bootstrap_requests'),1);
assert.equal(count(target.db,'reserve_internal.theme_revisions'),3);
assert.equal(count(target.db,'reserve_internal.theme_revision_events'),3);
assert.equal(count(target.db,'reserve_internal.published_theme_assignments'),0);
assert.equal(scalar(target.db,"SELECT tgenabled FROM pg_trigger WHERE tgrelid='reserve.audit_events'::regclass AND tgname='audit_guard';"),'O');
assert.equal(count(target.db,'public.arcana_readings'),1,'Arcana journal preserved');
assert.equal(count(target.db,'auth.users'),6,'Website and imported GoTrue accounts preserved');
console.log('PASS: atomic failed import left Website/Arcana/Auth untouched; successful tenant receipt + settings + Theme history CSV matches SOURCE exactly');

const targetUnassigned=await login(target,fixture.reserve.unassigned);
const targetOwner=await login(target,fixture.reserve.owner_a);
const targetReplay=await rpc(target,'reserve_bootstrap_setup_tenant',targetUnassigned,{request_key:key});
assert.deepEqual(targetReplay,{tenant_id:setup.tenant_id,membership_id:setup.membership_id,replayed:true});
const aRead=await rpc(target,'reserve_read_tenant_theme_revision',targetOwner,{
  target:TENANT_A,theme:createdA.theme_id,requested:1,
});
assert.equal(aRead.revision,1);
assert.deepEqual(aRead.tokens,{primary:'#aabbcc',accent:'#334455',typography:'serif'});
const cRead=await rpc(target,'reserve_read_tenant_theme',targetUnassigned,{
  target:setup.tenant_id,theme:createdC.theme_id,
});
assert.equal(cRead.theme_id,createdC.theme_id);
const denied=await rpc(target,'reserve_read_tenant_theme',targetOwner,{
  target:setup.tenant_id,theme:createdC.theme_id,
});
assert.equal(denied.error,'tenant_unavailable','Foreign tenant cannot access restored Theme');
const stale=await rpc(target,'reserve_save_tenant_theme_revision',targetOwner,{
  target:TENANT_A,theme:createdA.theme_id,expected:1,design_tokens:originalTokens,
});
assert.equal(stale.error,'revision_conflict','No revision may be silently overwritten');
assert.equal(count(target.db,'reserve_internal.theme_revisions'),3);
assert.equal(count(target.db,'reserve_internal.published_theme_assignments'),0);
console.log('PASS: target authentic GoTrue JWT replays bootstrap, reads preserved history, blocks foreign tenants, denies stale revisions and cannot publish');
console.log('LIMIT: synthetic M1 followed by M2.1/M2.2/M7 delta, not a hosted full-cutover operation');
