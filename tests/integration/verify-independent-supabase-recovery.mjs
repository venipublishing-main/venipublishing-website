// Independent-cluster recovery proof: every connection must be a disposable,
// loopback Supabase v3 CI stack. Synthetic-only passwords remain in runner temp.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_A='c1111111-1111-4111-8111-111111111111';
const TENANT_B='c2222222-2222-4222-8222-222222222222';
assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE,'yes');
assert.equal(process.env.VENI_ATOMIC_RESERVE_REHEARSAL,'yes');
assert.equal(process.env.VENI_CROSS_CLUSTER_RECOVERY,'yes');
const phase=process.env.VENI_RECOVERY_PHASE;
assert.ok(['database','auth'].includes(phase),'One explicit test phase required');
const privateHistory=process.env.VENI_RECOVERY_PRIVATE_HISTORY_DELTA==='yes';

function localUrl(label,raw,protocols){
  assert.ok(raw,`${label} required`);
  const u=new URL(raw);
  assert.ok(protocols.includes(u.protocol),`${label} protocol`);
  assert.ok(['127.0.0.1','localhost'].includes(u.hostname),`${label} loopback only`);
  assert.ok(+u.port>=20000 && +u.port<=32767,`${label} disposable CI port`);
  return u;
}
const source=localUrl('TARGET_DB_URL',process.env.TARGET_DB_URL,['postgres:','postgresql:']);
const clone=localUrl('RECOVERY_CLONE_DB_URL',process.env.RECOVERY_CLONE_DB_URL,['postgres:','postgresql:']);
assert.equal(source.pathname,'/postgres');
assert.equal(clone.pathname,'/veni_restored_ci');
assert.notEqual(source.port,clone.port,'Independent PostgreSQL servers required');
const credentialsPath=process.env.VENI_SYNTHETIC_RECOVERY_ACCOUNTS_FILE;
assert.ok(credentialsPath && process.env.RUNNER_TEMP &&
  credentialsPath.startsWith(`${process.env.RUNNER_TEMP}/veni-recovery-`));
const fixture=JSON.parse(readFileSync(credentialsPath,'utf8'));
for(const user of [fixture.website,...Object.values(fixture.reserve)]){
  assert.match(user.id,UUID);
  assert.ok(user.email.endsWith('@example.invalid') && user.password.length>15,
    'Only generated non-real accounts may be used');
}

function psql(db,sql){
  return execFileSync('psql',[db.href,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-f','-'],{
    input:sql,encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024,
    stdio:['pipe','pipe','pipe'],
  }).trim();
}
function json(db,sql){return JSON.parse(psql(db,sql));}
function ident(x){assert.match(x,/^[a-z_][a-z_0-9]*$/i);return `"${x}"`;}
function literal(s){return `'${String(s).replaceAll("'","''")}'`;}
function asUser(db,id,statement){
  assert.match(id,UUID);
  return psql(db,`BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub=${literal(id)};
  SET LOCAL request.jwt.claims=${literal(JSON.stringify({sub:id,role:'authenticated',is_anonymous:false}))};
  ${statement}
  COMMIT;`);
}

if(phase==='database'){
  const tables=`SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname)
   ORDER BY n.nspname,c.relname),'[]'::json)::text
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p') AND n.nspname IN ('auth','public','reserve','reserve_internal','storage');`;
  const original=json(source,tables);
  assert.deepEqual(json(clone,tables),original,'Independent table catalogue changed');
  assert.ok(original.length>=40,'Expected integrated Supabase/Auth table catalogue');
  for(const t of original){
    const name=`${ident(t.schema)}.${ident(t.table)}`;
    const sql=`SELECT json_build_object('rows',count(*),
       'digest',md5(coalesce(string_agg(row_to_json(t)::text,E'\\n'
         ORDER BY row_to_json(t)::text),'')))::text FROM ${name} t;`;
    assert.deepEqual(json(clone,sql),json(source,sql),`Cross-cluster data changed: ${name}`);
  }
  const rls=`SELECT coalesce(json_agg(json_build_object('schema',n.nspname,
   'table',c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity)
   ORDER BY n.nspname,c.relname),'[]'::json)::text
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','reserve','reserve_internal');`;
  assert.deepEqual(json(clone,rls),json(source,rls),'RLS enablement drift');
  const policies=`SELECT coalesce(json_agg(row_to_json(p)
    ORDER BY schemaname,tablename,policyname),'[]'::json)::text FROM pg_policies p
    WHERE schemaname IN ('public','reserve','reserve_internal');`;
  assert.deepEqual(json(clone,policies),json(source,policies),'RLS policy drift');
  const triggers=`SELECT coalesce(json_agg(json_build_object('table',n.nspname||'.'||c.relname,
    'name',t.tgname,'definition',pg_get_triggerdef(t.oid))
    ORDER BY n.nspname,c.relname,t.tgname),'[]'::json)::text
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('auth','public','reserve','reserve_internal');`;
  assert.deepEqual(json(clone,triggers),json(source,triggers),'Trigger drift');
  const owners=`SELECT coalesce(json_agg(json_build_object('schema',n.nspname,
    'object',c.relname,'owner',pg_get_userbyid(c.relowner)) ORDER BY n.nspname,c.relname),
    '[]'::json)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','S')
    AND n.nspname IN ('public','reserve','reserve_internal');`;
  assert.deepEqual(json(clone,owners),json(source,owners),'App object owner drift');
  const functionOwners=`SELECT coalesce(json_agg(json_build_object(
    'schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),
    'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef)
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    '[]'::json)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','reserve','reserve_internal');`;
  assert.deepEqual(json(clone,functionOwners),json(source,functionOwners),
    'Function owner or SECURITY DEFINER drift across servers');
  const executionRole=(role)=>`SELECT json_build_object('login',rolcanlogin,
    'superuser',rolsuper,'bypass_rls',rolbypassrls,'inherit',rolinherit,
    'create_db',rolcreatedb,'create_role',rolcreaterole,
    'role_config',rolconfig,
    'postgres_member',(SELECT count(*) FROM pg_auth_members m
      WHERE m.roleid=r.oid AND m.member='postgres'::regrole))::text
    FROM pg_roles r WHERE rolname='${role}';`;
  for (const role of ['reserve_settings_executor',
    ...(privateHistory?['reserve_bootstrap_executor','reserve_theme_executor']:[])]) {
    const roleConfig=json(clone,executionRole(role));
    assert.deepEqual(roleConfig,json(source,executionRole(role)),
      'Restricted execution role missing or weakened: '+role);
    assert.equal(roleConfig.login,false);
    assert.equal(roleConfig.superuser,false);
    assert.equal(roleConfig.bypass_rls,false);
    assert.equal(roleConfig.postgres_member,0);
  }
  // PostgreSQL role OIDs may differ between servers: compare role *names*,
  // excluding redundant owner self-grants, not raw OIDs.
  const grants=`WITH grants AS (
    SELECT n.nspname AS schema_name,c.relname AS object_name,
      pg_get_userbyid(a.grantor) AS grantor,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
      a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relkind IN ('r','p','v','m','S')
      AND n.nspname IN ('public','reserve','reserve_internal')
      AND a.grantee<>a.grantor
  ) SELECT coalesce(json_agg(row_to_json(g) ORDER BY schema_name,object_name,
    grantor,grantee,privilege_type,is_grantable),'[]'::json)::text FROM grants g;`;
  assert.deepEqual(json(clone,grants),json(source,grants),'App nonowner grant drift');
  assert.equal(psql(clone,`SELECT tgenabled FROM pg_trigger
   WHERE tgrelid='reserve.audit_events'::regclass AND tgname='audit_guard';`),'O');
  const counts=json(clone,`SELECT json_build_object(
    'auth',(SELECT count(*) FROM auth.users),
    'identities',(SELECT count(*) FROM auth.identities),
    'profiles',(SELECT count(*) FROM public.profiles),
    'arcana',(SELECT count(*) FROM public.arcana_readings),
    'reserve_users',(SELECT count(*) FROM reserve.users),
    'tenants',(SELECT count(*) FROM reserve.tenants),
    'memberships',(SELECT count(*) FROM reserve.memberships),
    'audit',(SELECT count(*) FROM reserve.audit_events))::text;`);
  assert.deepEqual(counts,{auth:6,identities:6,profiles:6,arcana:1,
    reserve_users:5,tenants:privateHistory?3:2,
    memberships:privateHistory?5:4,audit:privateHistory?4:2});
  if(privateHistory){
    const protectedCount=json(clone,`SELECT json_build_object(
      'receipts',(SELECT count(*) FROM reserve_internal.tenant_bootstrap_requests),
      'settings',(SELECT count(*) FROM reserve_internal.tenant_business_settings),
      'settings_changes',(SELECT count(*) FROM reserve_internal.tenant_business_settings_changes),
      'themes',(SELECT count(*) FROM reserve_internal.themes),
      'revisions',(SELECT count(*) FROM reserve_internal.theme_revisions),
      'revision_events',(SELECT count(*) FROM reserve_internal.theme_revision_events),
      'published',(SELECT count(*) FROM reserve_internal.published_theme_assignments))::text;`);
    assert.deepEqual(protectedCount,{receipts:1,settings:2,settings_changes:2,
      themes:2,revisions:3,revision_events:3,published:0});
    assert.throws(()=>psql(clone,`UPDATE reserve_internal.theme_revisions
      SET tokens='{}'::jsonb WHERE revision=1;`),/immutable|cannot|permission denied/i);
    assert.throws(()=>psql(clone,`DELETE FROM reserve_internal.theme_revision_events;`),
      /immutable|cannot|permission denied/i);
    assert.throws(()=>psql(clone,`DELETE FROM reserve_internal.tenant_business_settings_changes;`),
      /immutable|cannot|permission denied/i);
  }
  const ownerRls=asUser(clone,fixture.reserve.owner_a.id,
    'SELECT count(*) FROM reserve.tenants; SELECT public.reserve_account_deletion_preflight();');
  assert.deepEqual(ownerRls.split('\n').filter(Boolean),['1','OWNER_TRANSFER_REQUIRED']);
  const rogueRls=asUser(clone,fixture.website.id,'SELECT count(*) FROM reserve.tenants;');
  assert.deepEqual(rogueRls.split('\n').filter(Boolean),['0']);
  if(privateHistory){
    const newOwner=asUser(clone,fixture.reserve.unassigned.id,
      'SELECT count(*) FROM reserve.tenants;');
    assert.deepEqual(newOwner.split('\n').filter(Boolean),['1'],
      'Imported bootstrap Owner must keep only their own tenant');
    console.log('PASS: third-server receipt, settings, immutable revision history, private grants and closed publication retained');
  }
  console.log(`PASS: ${original.length} tables matched across physically separate disposable PostgreSQL stacks`);
  console.log('PASS: independent database RLS, trigger, owners, grants, tenants, Website/Arcana history, deletion guard');
}

if(phase==='auth'){
  const api=localUrl('RECOVERED_GOTRUE_URL',process.env.RECOVERED_GOTRUE_URL,['http:']);
  assert.equal(api.pathname,'/auth/v1','Use third native local Supabase GoTrue service');
  const authDb=localUrl('RECOVERY_AUTH_DB_URL',process.env.RECOVERY_AUTH_DB_URL,
    ['postgres:','postgresql:']);
  assert.equal(authDb.port,clone.port,'Recovered Auth service must use independent PostgreSQL server');
  assert.equal(authDb.pathname,'/postgres','Third native Auth database required');
  assert.ok(process.env.RECOVERED_ANON_KEY?.length>20,'Third local public key required');
  assert.equal(psql(authDb,'SELECT count(*) FROM auth.users;'),'6');
  assert.equal(psql(authDb,'SELECT count(*) FROM auth.identities;'),'6');
  const userCredentials=`SELECT md5(coalesce(string_agg(
    id::text||':'||coalesce(email,'')||':'||coalesce(encrypted_password,''),'|'
    ORDER BY id),'')) FROM auth.users;`;
  const identityLinks=`SELECT md5(coalesce(string_agg(
    id::text||':'||user_id::text||':'||provider||':'||provider_id,'|'
    ORDER BY id),'')) FROM auth.identities;`;
  assert.equal(psql(authDb,userCredentials),psql(clone,userCredentials),
    'Recovered credentials or original Auth UUIDs changed on third server');
  assert.equal(psql(authDb,identityLinks),psql(clone,identityLinks),
    'Recovered provider identity keys changed on third server');
  const base=new URL(`${api.href.replace(/\/$/,'')}/`);
  async function request(path,token,body){
    const headers={apikey:process.env.RECOVERED_ANON_KEY};
    if(token)headers.authorization=`Bearer ${token}`;
    if(body!==undefined)headers['content-type']='application/json';
    const res=await fetch(new URL(path.replace(/^\/+/,''),base),{
      method:body===undefined?'GET':'POST',headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000),
    });
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  const accounts=[fixture.website,...Object.values(fixture.reserve)];
  for(const account of accounts){
    const r=await request('/token?grant_type=password',null,
      {email:account.email,password:account.password});
    assert.ok(r.status>=200&&r.status<300,
      `Recovered GoTrue password login failed for synthetic account: ${r.status} ${r.data?.error_code||''}`);
    assert.equal(r.data.user?.id,account.id,'Recovered account UUID changed');
    assert.ok(r.data.access_token && r.data.refresh_token,'Recovered real session required');
    const me=await request('/user',r.data.access_token);
    assert.equal(me.status,200,'Recovered token must validate with its own Auth service');
    assert.equal(me.data.id,account.id);
  }
  const rejected=await request('/user',fixture.oldTargetToken);
  assert.ok(rejected.status>=400,'Old destination JWT must not validate under recovered signing secret');
  const query=asUser(clone,fixture.reserve.owner_a.id,
    'SELECT count(*) FROM reserve.tenants; SELECT public.reserve_account_deletion_preflight();');
  assert.deepEqual(query.split('\n').filter(Boolean),['1','OWNER_TRANSFER_REQUIRED']);
  console.log('PASS: third independent native GoTrue signed in six restored users with original UUIDs/passwords');
  console.log('PASS: old target JWT rejected by separate Auth authority; full-clone tenant/deletion RLS retained');
  console.log('LIMIT: fresh Auth service uses compatible third-stack Auth catalogue imported from clone, not GoTrue startup on full clone');
  console.log('GATE OPEN: hosted Auth configs/OAuth/MFA, Storage bytes, Vault keys, cross-project secrets and production cutover');
}
