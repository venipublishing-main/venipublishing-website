// Local-only GoTrue/PostgREST proof that private Reserve Theme revisions can
// live beside Website and Arcana without exposing publication or history.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.VENI_SHARED_THEME_DISPOSABLE,'yes');
const api = new URL(process.env.API_URL || 'http://invalid');
const db = new URL(process.env.DB_URL || 'postgres://invalid');
assert.equal(api.protocol,'http:');
assert.ok(['postgres:','postgresql:'].includes(db.protocol));
for(const [url,port] of [[api,'54321'],[db,'54322']]) {
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.port,port);
}
assert.equal(db.pathname,'/postgres');
const key = process.env.ANON_KEY || process.env.PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(key);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const q=(v)=>{assert.match(v,UUID);return `'${v}'::uuid`;};
function scalar(sql) {
  return execFileSync('psql',[db.href,'-X','-A','-q','-t','-v','ON_ERROR_STOP=1','-c',sql],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024}).trim();
}
async function request(path,{method='POST',token,body,profile}={}) {
  const headers={apikey:key};
  if(token) headers.authorization=`Bearer ${token}`;
  else if(key.startsWith('eyJ')) headers.authorization=`Bearer ${key}`;
  if(body!==undefined) headers['content-type']='application/json';
  if(profile) headers['Accept-Profile']=profile;
  const response=await fetch(new URL(path,api),{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(25000),
  });
  const raw=await response.text();
  let data=raw;try{data=JSON.parse(raw);}catch{/* empty or scalar */}
  return {status:response.status,data};
}
const rpc=(name,token,body={})=>request(`/rest/v1/rpc/reserve_${name}`,{token,body});
function ok(value,label){
  assert.ok(value.status>=200&&value.status<300,
    `${label}: HTTP ${value.status}: ${JSON.stringify(value.data).slice(0,350)}`);
  return value.data;
}
const tag=`${Date.now()}-${randomUUID().slice(0,8)}`;
const pwd=`Synthetic-${tag}-Local!85`;
async function signUp(label,metadata={}){
  const account=ok(await request('/auth/v1/signup',{body:{
    email:`theme-${label}-${tag}@example.invalid`,password:pwd,data:metadata,
  }}),`Theme ${label} real sign-up`);
  assert.match(account.user?.id||'',UUID);
  assert.ok(account.access_token&&account.refresh_token);
  return {id:account.user.id,token:account.access_token};
}
async function bootstrap(actor){
  const receipt=ok(await rpc('bootstrap_setup_tenant',actor.token,{request_key:randomUUID()}),
    'Theme Owner SETUP bootstrap');
  assert.match(receipt.tenant_id,UUID);
  return receipt.tenant_id;
}

const a=await signUp('a',{display_name:'Theme A'});
const b=await signUp('b',{display_name:'Theme B'});
const outsider=await signUp('forged',{role:'Owner',tenant_id:randomUUID()});
const tenantA=await bootstrap(a);
const tenantB=await bootstrap(b);
assert.notEqual(tenantA,tenantB);

const ownList=ok(await rpc('list_tenant_themes',a.token,{target:tenantA}),
  'A sees own empty private Theme library');
assert.deepEqual(ownList.themes,[]);
assert.equal(ok(await rpc('list_tenant_themes',b.token,{target:tenantA}),
  'Foreign library read').error,'tenant_unavailable');
assert.equal(ok(await rpc('list_tenant_themes',outsider.token,{target:tenantA}),
  'User-metadata Owner forgery').error,'tenant_unavailable');

const tokens={primary:'#ABCDEF',accent:'#000001',typography:'serif'};
const invalid=[
  {...tokens,css:'body{background:black}'},
  {...tokens,primary:'#fff'},
  {...tokens,accent:'red'},
  {...tokens,typography:'url(https://malicious.invalid/font)'},
];
for(const design_tokens of invalid){
  const answer=ok(await rpc('create_tenant_theme',a.token,{
    target:tenantA,theme_name:'Untrusted Appearance',design_tokens,
  }), 'Unsafe Theme design token');
  assert.equal(answer.error,'invalid_input');
}
const first=ok(await rpc('create_tenant_theme',a.token,{
  target:tenantA,theme_name:'VVB Blue',design_tokens:tokens,
}), 'Create private Theme');
assert.match(first.theme_id,UUID);
assert.equal(first.current_revision,1);
assert.deepEqual(first.tokens,{primary:'#abcdef',accent:'#000001',typography:'serif'});
const theme=first.theme_id;
assert.equal(ok(await rpc('create_tenant_theme',a.token,{
  target:tenantA,theme_name:'VVB Blue',design_tokens:tokens,
}), 'Duplicate name').error,'duplicate_name');
assert.equal(ok(await rpc('read_tenant_theme',b.token,{target:tenantA,theme}),
  'B cannot see A Theme').error,'tenant_unavailable');
assert.equal(ok(await rpc('create_tenant_theme',b.token,{
  target:tenantA,theme_name:'Foreign Theme',design_tokens:tokens,
}), 'B cannot create Theme in A').error,'tenant_unavailable');
const list=ok(await rpc('list_tenant_themes',a.token,{target:tenantA}), 'A lists private Themes');
assert.deepEqual(list.themes.map(t=>t.theme_id),[theme]);

const revised={primary:'#112233',accent:'#445566',typography:'system'};
const second=ok(await rpc('save_tenant_theme_revision',a.token,{
  target:tenantA,theme,expected:1,design_tokens:revised,
}), 'Save Theme revision');
assert.equal(second.current_revision,2);
assert.deepEqual(second.tokens,revised);
assert.deepEqual(second.history.map(r=>r.revision),[2,1]);
assert.equal(ok(await rpc('save_tenant_theme_revision',a.token,{
  target:tenantA,theme,expected:1,design_tokens:tokens,
}), 'Stale revision').error,'revision_conflict');
const old=ok(await rpc('read_tenant_theme_revision',a.token,{
  target:tenantA,theme,requested:1,
}), 'Immutable earlier version');
assert.equal(old.revision,1);
assert.deepEqual(old.tokens,{primary:'#abcdef',accent:'#000001',typography:'serif'});
assert.equal(ok(await rpc('read_tenant_theme_revision',b.token,{
  target:tenantA,theme,requested:1,
}), 'Foreign historical revision').error,'tenant_unavailable');
assert.equal(ok(await rpc('save_tenant_theme_revision',b.token,{
  target:tenantA,theme,expected:2,design_tokens:revised,
}), 'Foreign edit').error,'tenant_unavailable');

assert.equal(scalar(`select count(*) from reserve_internal.theme_revisions
  where tenant_id=${q(tenantA)} and theme_id=${q(theme)}`),'2');
assert.equal(scalar(`select count(*) from reserve_internal.theme_revision_events
  where tenant_id=${q(tenantA)} and theme_id=${q(theme)}`),'2');
assert.equal(scalar('select count(*) from reserve_internal.published_theme_assignments'),'0');
assert.throws(()=>scalar(`update reserve_internal.theme_revisions set tokens='{}'::jsonb
  where tenant_id=${q(tenantA)} and theme_id=${q(theme)} and revision=1`),
  /immutable|permission denied|cannot/i,'Database must reject rewriting history');
assert.throws(()=>scalar(`delete from reserve_internal.theme_revision_events
  where tenant_id=${q(tenantA)} and theme_id=${q(theme)} and revision=1`),
  /immutable|permission denied|cannot/i,'Database must reject deleting history');
const attemptedPublication=await rpc('publish_tenant_theme',a.token,{
  target:tenantA,theme,
});
assert.ok(attemptedPublication.status>=400, 'No publication RPC exists');
const attemptedPrivate=await request('/rest/v1/themes?select=id',{
  method:'GET',token:a.token,profile:'reserve_internal',body:undefined,
});
assert.ok(attemptedPrivate.status>=400, 'No Data API access to private Themes');
assert.equal(scalar('select count(*) from reserve_internal.published_theme_assignments'),'0');

// Live parent Website and Arcana functions must retain independence and their
// own grants, despite a shared Auth identity and three Theme revisions.
const website=ok(await request('/rest/v1/profiles?select=id',{
  method:'GET',token:a.token,body:undefined,
}), 'Website parent account profile');
assert.deepEqual(website.map(r=>r.id),[a.id]);
const previousArcanaCount=Number(scalar('select count(*) from public.arcana_readings'));
const cards=ok(await request('/rest/v1/arcana_cards?select=id&status=eq.pilot',{
  method:'GET',token:a.token,body:undefined,
}), 'Arcana card catalog');
assert.ok(cards.length);
const journal=ok(await request('/rest/v1/rpc/save_arcana_single_card_reading',{
  token:a.token,body:{p_card_id:cards[0].id,p_question:'Shared Veni Theme?',p_note:'Local synthetic proof.'},
}), 'Arcana journal creation');
assert.match(journal,UUID);
assert.deepEqual(ok(await request('/rest/v1/arcana_readings?select=id',{
  method:'GET',token:b.token,body:undefined,
}), 'Arcana B isolation'),[]);

ok(await request('/auth/v1/logout?scope=global',{token:a.token,body:undefined}),
  'Revoke real GoTrue session');
assert.equal(ok(await rpc('read_tenant_theme',a.token,{target:tenantA,theme}),
  'Revoked JWT must not read Theme').error,'unauthorized');
assert.equal(ok(await rpc('save_tenant_theme_revision',a.token,{
  target:tenantA,theme,expected:2,design_tokens:tokens,
}), 'Revoked JWT must not save').error,'unauthorized');
assert.equal(scalar(`select count(*) from reserve_internal.theme_revisions
  where theme_id=${q(theme)}`),'2');
assert.equal(Number(scalar('select count(*) from public.arcana_readings')),previousArcanaCount+1);
console.log('PASS: private Theme revision history, role/RLS isolation, invalid tokens, revision conflicts, publication closed, revoked JWT and Website/Arcana preserved');
