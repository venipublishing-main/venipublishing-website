// Compare a PostgreSQL logical dump (excluding protected vault.secrets data)
// restored to a clean DB on the disposable Website stack. No hosted URLs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function loopback(label,value) {
  assert.ok(value,`${label} is required`);
  const url=new URL(value);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),`${label} must be local`);
  assert.ok(Number(url.port)>=20000 && Number(url.port)<=32767,
    `${label} must use a disposable Supabase stack port`);
  return url;
}
assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE,'yes');
assert.equal(process.env.VENI_ATOMIC_RESERVE_REHEARSAL,'yes');
assert.equal(process.env.VENI_FULL_RESTORE_CI,'yes');
const before=loopback('TARGET_DB_URL',process.env.TARGET_DB_URL);
const after=loopback('RESTORED_DB_URL',process.env.RESTORED_DB_URL);
assert.equal(before.hostname,after.hostname);
assert.equal(before.port,after.port);
assert.equal(before.pathname,'/postgres');
assert.equal(after.pathname,'/veni_restored_ci');

function psql(db,sql) {
  return execFileSync('psql',[db.href,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],{
    input:sql,encoding:'utf8',timeout:40000,maxBuffer:4*1024*1024,
    stdio:['pipe','pipe','pipe'],
  }).trim();
}
function json(db,sql) {return JSON.parse(psql(db,sql));}
function sqlIdent(name) {assert.match(name,/^[a-z_][a-z_0-9]*$/i);return `"${name}"`;}

// Compare every ordinary/partitioned table in app and managed Auth schemas,
// including every password-hash column; only SHA-like fingerprints are kept
// in memory. Never print either the values or their fingerprints.
const columns=`SELECT coalesce(json_agg(json_build_object(
   'schema',n.nspname,'table',c.relname) ORDER BY n.nspname,c.relname),'[]'::json)::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN
 ('auth','public','reserve','reserve_internal','storage');`;
const originalTables=json(before,columns);
const restoredTables=json(after,columns);
assert.deepEqual(restoredTables,originalTables,'Full backup must preserve table catalogue');
assert.ok(originalTables.length>=30,'Expected complete Supabase/Auth/Website/Reserve table collection');

for(const table of originalTables) {
  const ident=`${sqlIdent(table.schema)}.${sqlIdent(table.table)}`;
  const fingerprint=`SELECT json_build_object(
   'rows',count(*),
   'digest',md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),''))
 )::text FROM ${ident} t;`;
  const source=json(before,fingerprint),restored=json(after,fingerprint);
  assert.deepEqual(restored,source,`Data rows diverged after restore: ${ident}`);
}

// RLS must remain enabled, and grants/policies/triggers must be reconstructed.
const rls=`SELECT coalesce(json_agg(json_build_object(
  'schema',n.nspname,'table',c.relname,'enabled',c.relrowsecurity,
  'forced',c.relforcerowsecurity) ORDER BY n.nspname,c.relname),'[]'::json)::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','reserve','reserve_internal');`;
assert.deepEqual(json(after,rls),json(before,rls),'RLS settings changed in backup/restore');
const policy=`SELECT coalesce(json_agg(row_to_json(p) ORDER BY schemaname,tablename,policyname),'[]'::json)::text
 FROM pg_policies p WHERE schemaname IN ('public','reserve','reserve_internal');`;
assert.deepEqual(json(after,policy),json(before,policy),'RLS policy definitions changed');
const applicationGrants=`WITH grants AS (
 SELECT n.nspname AS schema_name, c.relname AS object_name,
   a.grantor::text, a.grantee::text, a.privilege_type, a.is_grantable
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(c.relacl) a
 WHERE c.relkind IN ('r','p','v','m','S')
   AND n.nspname IN ('public','reserve','reserve_internal')
) SELECT coalesce(json_agg(row_to_json(g) ORDER BY schema_name,object_name,
 grantor,grantee,privilege_type,is_grantable),'[]'::json)::text FROM grants g;`;
assert.deepEqual(json(after,applicationGrants),json(before,applicationGrants),
  'Veni application table/view/sequence privileges changed during restore');
const triggers=`SELECT coalesce(json_agg(json_build_object('table',n.nspname||'.'||c.relname,
   'name',t.tgname,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::json)::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('auth','public','reserve','reserve_internal');`;
assert.deepEqual(json(after,triggers),json(before,triggers),'Application trigger definitions changed');

const expected=json(after,`SELECT json_build_object(
 'auth',(SELECT count(*) FROM auth.users),
 'identity',(SELECT count(*) FROM auth.identities),
 'profiles',(SELECT count(*) FROM public.profiles),
 'arcana',(SELECT count(*) FROM public.arcana_readings),
 'reserve_users',(SELECT count(*) FROM reserve.users),
 'tenants',(SELECT count(*) FROM reserve.tenants),
 'memberships',(SELECT count(*) FROM reserve.memberships),
 'audit',(SELECT count(*) FROM reserve.audit_events),
 'invitations',(SELECT count(*) FROM reserve_internal.invitations))::text;`);
assert.deepEqual(expected,{auth:6,identity:6,profiles:6,arcana:1,reserve_users:5,
  tenants:2,memberships:4,audit:2,invitations:1});

const owner=psql(after,`SELECT user_id::text FROM reserve.memberships
  WHERE id='e1111111-1111-4111-8111-111111111111'::uuid;`);
assert.match(owner,/^[0-9a-f-]{36}$/i);
const rlsProof=psql(after,`BEGIN;
 SET LOCAL ROLE authenticated;
 SET LOCAL request.jwt.claim.sub='${owner}';
 SET LOCAL request.jwt.claims='{"is_anonymous":false}';
 SELECT count(*) FROM reserve.tenants;
 SELECT public.reserve_account_deletion_preflight();
 COMMIT;`);
assert.deepEqual(rlsProof.split('\n').filter(Boolean),['1','OWNER_TRANSFER_REQUIRED'],
  'Restored owner lost tenant access or deletion guard');
assert.equal(psql(after,`SELECT tgenabled FROM pg_trigger
 WHERE tgrelid='reserve.audit_events'::regclass AND tgname='audit_guard';`),'O',
 'Immutable audit guard must remain enabled');

console.log('PASS: PostgreSQL application/Auth/Storage metadata dump restored to a separate clean database (Vault secret data intentionally excluded)');
console.log(`PASS: ${originalTables.length} Auth/Website/Reserve/Storage table datasets match exactly`);
console.log('PASS: RLS settings, policies, application grants, triggers, owner access, audit and deletion guard restored');
console.log('GATE OPEN: global roles, external Storage object bytes, Vault/root keys, Edge secrets, and GoTrue login against the clone still require separate evidence');
