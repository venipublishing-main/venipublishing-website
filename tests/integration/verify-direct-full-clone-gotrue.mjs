// Local-only recovery gate: restart the *same* pinned native GoTrue image
// directly on a complete, independently restored synthetic Website/Reserve DB.
// This does not connect to or modify any hosted Supabase instance.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {basename,join} from 'node:path';

for(const flag of ['VENI_DUAL_AUTH_DISPOSABLE','VENI_ATOMIC_RESERVE_REHEARSAL',
  'VENI_CROSS_CLUSTER_RECOVERY','VENI_FULL_CLONE_AUTH_DISPOSABLE']){
  assert.equal(process.env[flag],'yes',`Missing explicit local-only gate ${flag}`);
}
const temp=process.env.RUNNER_TEMP;
assert.ok(temp==='/home/runner/work/_temp' ||
  temp?.startsWith('/home/runner/work/_temp/'),'GitHub Actions runner temp required');
const credentialsPath=process.env.VENI_SYNTHETIC_RECOVERY_ACCOUNTS_FILE;
assert.ok(credentialsPath?.startsWith(`${temp}/veni-recovery-`),'Runner-only fixture required');
const fixture=JSON.parse(readFileSync(credentialsPath,'utf8'));
const accounts=[fixture.website,...Object.values(fixture.reserve)];
assert.equal(accounts.length,6,'Exactly six synthetic accounts required');
for(const a of accounts){
  assert.ok(a.email.endsWith('@example.invalid') && a.password.length>15,
    'Never use non-synthetic credentials');
}

function localDb(name,raw,pathname){
  assert.ok(raw,`${name} required`);
  const u=new URL(raw);
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
  assert.ok(['localhost','127.0.0.1'].includes(u.hostname));
  assert.ok(+u.port>=20000 && +u.port<=32767);
  assert.equal(u.pathname,pathname);
  return u;
}
const clone=localDb('RECOVERY_CLONE_DB_URL',process.env.RECOVERY_CLONE_DB_URL,
  '/veni_restored_ci');
const native=localDb('RECOVERY_DB_URL',process.env.RECOVERY_DB_URL,'/postgres');
const target=localDb('TARGET_DB_URL',process.env.TARGET_DB_URL,'/postgres');
assert.equal(native.port,clone.port);
assert.notEqual(target.port,clone.port,'Cloned server must be independent');

function command(bin,args,opts={}){
  return execFileSync(bin,args,{encoding:'utf8',timeout:45000,
    maxBuffer:3*1024*1024,stdio:['pipe','pipe','pipe'],...opts}).trim();
}
function psql(db,sql){
  return command('psql',[db.href,'-X','-A','-t','-v','ON_ERROR_STOP=1',
    '-v','VERBOSITY=terse','-c',sql]);
}
function authShape(db){
  const sql=`SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.table_name),
    '[]'::json)::text FROM (SELECT table_name,
      array_agg(column_name ORDER BY ordinal_position) AS columns
    FROM information_schema.columns WHERE table_schema='auth'
      AND table_name IN ('oauth_clients','schema_migrations')
    GROUP BY table_name) x;`;
  return JSON.parse(psql(db,sql));
}
const sourceShape=authShape(target);
const cloneShape=authShape(clone);
assert.deepEqual(cloneShape,sourceShape,
  'The independently restored Auth schema must match original target');
console.log('PASS: source and full-clone OAuth/migration column catalogues match');
console.log('Auth schema catalogue (nonsecret column names): '+JSON.stringify(cloneShape));
for(const [label,db] of [['original target',target],['full clone',clone]]){
  const tableNames=cloneShape.map(x=>x.table_name);
  if(tableNames.includes('schema_migrations')){
    const count=psql(db,`SELECT count(*) FROM auth.schema_migrations`);
    const contains=psql(db,`SELECT count(*) FROM auth.schema_migrations
      WHERE version::text='20250731150234'`);
    console.log(`${label}: Auth migration count=${count}, OAuth migration recorded=${contains}`);
  }
}

const containers=command('docker',['ps','--format','{{json .}}']).split('\n')
  .filter(Boolean).map(line=>JSON.parse(line));
// Only container names, image labels and published ports are diagnostic data.
// Never display container environment, credentials, secrets or mounted files.
console.log('Disposable Docker container metadata: '+JSON.stringify(
  containers.map(x=>({name:x.Names,image:x.Image,ports:x.Ports}))));
// CLI v3's DB_URL is a loopback *proxy* port, not the raw published Docker
// database port. Its tested container naming scheme is service-name based.
// Identify only the recovery stack's auth service by both name and pinned
// image, avoiding a guess based on those different port namespaces.
const candidates=containers.filter(x=>
  x.Names.startsWith('supabase-integrated-auth-recovery-auth-') &&
  x.Image==='ghcr.io/supabase/cli/auth:v2.197.0-r0');
assert.equal(candidates.length,1,
  `Expected exactly one local third-stack GoTrue container; found ${candidates.length}`);
const nativeAuth=JSON.parse(command('docker',['inspect',candidates[0].ID]))[0];
// Image IDs and inspect.Config.Image may use an immutable digest while the
// docker-ps image field retains the same verified pinned tag.
const image=candidates[0].Image;
assert.equal(image,'ghcr.io/supabase/cli/auth:v2.197.0-r0',
  'Only the identical pinned native local GoTrue image is allowed');
// CLI v3's slim Auth image can have no default executable; the CLI supplies
// the command to the container when it creates the native Auth service.
// Reproduce that *observed* executable/args, with an explicit allowlist.
const executable=nativeAuth.Path;
assert.ok(['auth','gotrue','supabase-auth'].includes(basename(executable)),
  `Unrecognized CLI GoTrue process name: ${basename(executable)}`);
const executableArgs=nativeAuth.Args||[];
assert.ok(Array.isArray(executableArgs)&&executableArgs.every(x=>
  typeof x==='string' && !/[\r\n]/.test(x)), 'Unexpected CLI process arguments');
console.log(`Native GoTrue executable name: ${basename(executable)}, argc=${executableArgs.length}`);
const env=new Map(nativeAuth.Config.Env.map(item=>{
  const at=item.indexOf('=');
  assert.ok(at>0,'Malformed container environment');
  return [item.slice(0,at),item.slice(at+1)];
}));
console.log(`Native local GoTrue image: ${image}`);
console.log(`Native local migration path: ${env.get('GOTRUE_DB_MIGRATIONS_PATH')||'(image default)'}`);
console.log('Native mount destinations (paths only): '+JSON.stringify(
  nativeAuth.Mounts.map(m=>m.Destination)));
console.log('Native local Auth DB variable NAMES: '+JSON.stringify(
  [...env.keys()].filter(k=>/^(?:DATABASE_URL|DB_DATABASE_URL|GOTRUE_DB_)/.test(k)).sort()));

// Preserve the source container's migration location and every non-DB runtime
// option, while overriding *all* possible DB URL aliases to this disposable
// clone. Never print or persist actual secrets beyond this runner's temp file.
for(const key of ['GOTRUE_DB_DATABASE_URL','DATABASE_URL','DB_DATABASE_URL']){
  env.set(key,clone.href);
}
const port=18982;
env.set('GOTRUE_API_PORT',String(port));
env.set('PORT',String(port));
env.set('GOTRUE_API_HOST','127.0.0.1');
env.set('API_EXTERNAL_URL',`http://127.0.0.1:${port}`);
env.set('GOTRUE_API_API_EXTERNAL_URL',`http://127.0.0.1:${port}`);
env.set('GOTRUE_SITE_URL',`http://127.0.0.1:${port}`);
// No attempt to suppress or forge schema_migrations. Run the exact GoTrue
// migrator that the native CLI stack uses, then prove real password logins.
env.delete('GOTRUE_DB_AUTOMIGRATE');
const file=join(temp,`veni-gotrue-full-clone-${process.pid}.env`);
const name=`veni-gotrue-clone-${process.pid}`;
let started=false;
function sanitizedLog(){
  // Docker streams GoTrue's structured logs on stderr even when its `logs`
  // command succeeds. Capture both streams, then print only bounded,
  // redacted diagnostic lines, never entire output or environment values.
  const result=spawnSync('docker',['logs','--tail','18',name],{
    encoding:'utf8',timeout:20000,maxBuffer:256*1024,
  });
  const output=`${result.stdout||''}\n${result.stderr||''}`;
  const lines=output.split('\n').filter(x=>
    /migration|oauth|SQLSTATE|error|fatal|database/i.test(x));
  const redacted=lines.slice(-5).map(line=>line
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[REDACTED-DB-URL]')
    .replace(/(?:(?:secret|password|token)[=:])[^\s,]+/gi,'[REDACTED]')
    .slice(0,650));
  if(redacted.length)console.error('GoTrue bounded diagnosis: '+redacted.join('\n'));
}
async function run(){
  for(const [key,value] of env){
    assert.match(key,/^[A-Z][A-Z0-9_]*$/,'Environment key shape');
    assert.ok(!value.includes('\n')&&!value.includes('\r'),
      'Multiline container values cannot be copied to env-file safely');
  }
  writeFileSync(file,[...env].map(([k,v])=>`${k}=${v}`).join('\n')+'\n',
    {mode:0o600,flag:'wx'});
  const args=['run','--detach','--name',name,'--network','host',
    '--volumes-from',candidates[0].ID,'--env-file',file,
    '--entrypoint',executable,image,...executableArgs];
  command('docker',args);
  started=true;
  rmSync(file,{force:true});

  let ready=false;
  for(let i=0;i<40;i++){
    const running=command('docker',['inspect','-f','{{.State.Running}}',name]);
    if(running!=='true')break;
    try{
      const resp=await fetch(`http://127.0.0.1:${port}/health`,
        {signal:AbortSignal.timeout(1000)});
      if(resp.ok){ready=true;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready){
    sanitizedLog();
    console.error('Direct GoTrue container exit code: '+
      command('docker',['inspect','-f','{{.State.ExitCode}}',name]));
    throw new Error('GATE OPEN: standalone GoTrue failed to start on full restored database');
  }
  console.log('PASS: GoTrue image started directly against full independent snapshot');
  const base=`http://127.0.0.1:${port}`;
  async function request(path,token,body){
    const headers={};
    if(token)headers.authorization=`Bearer ${token}`;
    if(body!==undefined)headers['content-type']='application/json';
    const r=await fetch(`${base}${path}`,{
      method:body===undefined?'GET':'POST',headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000),
    });
    return {status:r.status,data:await r.json().catch(()=>({}))};
  }
  assert.equal(psql(clone,'SELECT count(*) FROM auth.users;'),'6');
  assert.equal(psql(clone,'SELECT count(*) FROM auth.identities;'),'6');
  for(const account of accounts){
    const result=await request('/token?grant_type=password',null,
      {email:account.email,password:account.password});
    assert.ok(result.status>=200&&result.status<300,
      `Direct full-clone password login failed: ${result.status} ${result.data.error_code||''}`);
    assert.equal(result.data.user?.id,account.id);
    assert.ok(result.data.access_token && result.data.refresh_token);
    const user=await request('/user',result.data.access_token);
    assert.equal(user.status,200);
    assert.equal(user.data.id,account.id);
  }
  const old=await request('/user',fixture.oldTargetToken);
  assert.ok(old.status>=400,'Old target signing authority must remain rejected');
  console.log('PASS: all six passwords, original UUIDs and fresh JWTs work directly on full clone');
  console.log('PASS: old Website JWT rejected; hosted cutover and provider configurations remain untested');
}
try{
  await run();
}finally{
  rmSync(file,{force:true});
  if(started){
    try{command('docker',['rm','--force',name]);}catch{}
  }
}
