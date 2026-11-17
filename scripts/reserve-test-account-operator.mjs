// DRAFT: deliberately LOCAL-CI-ONLY Reserve test-account operator.
// There is no hosted mode, remote override, public endpoint or arbitrary purge.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ALLOWED_OUTCOMES = new Set(['DENIED', 'PREPARED', 'SUCCEEDED', 'FAILED', 'COMPENSATED']);

function sha256(v) { return createHash('sha256').update(v).digest('hex'); }
function quoted(v) { return `'${String(v).replaceAll("'", "''")}'`; }

export function planSyntheticReserveCleanup(snapshot, request) {
  const reasons = [];
  if (!UUID.test(request?.id || '')) reasons.push('INVALID_TARGET_ID');
  if (typeof request?.email !== 'string' || !/^[^\s@]+@example\.invalid$/i.test(request.email))
    reasons.push('NON_SYNTHETIC_EMAIL');
  if (typeof request?.fixture !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(request.fixture))
    reasons.push('INVALID_FIXTURE_NONCE');
  if (!snapshot?.account) reasons.push('ACCOUNT_NOT_FOUND');
  else {
    if (snapshot.account.id !== request.id ||
      snapshot.account.email?.toLowerCase() !== request.email?.toLowerCase())
      reasons.push('ACCOUNT_ID_EMAIL_MISMATCH');
    // Trusted app_metadata only; raw_user_meta_data is owner-editable.
    if (snapshot.account.fixture !== request.fixture) reasons.push('TRUSTED_FIXTURE_MARKER_MISSING');
  }
  // Exactly one Reserve projection and zero durable dependencies. This is a
  // narrow unassigned-identity cleanup, NOT a way to purge memberships/audit.
  if (snapshot?.reserveProjectionCount !== 1) reasons.push('RESERVE_PROJECTION_NOT_SINGLE');
  if (!Number.isInteger(snapshot?.emailInvitationCount) || snapshot.emailInvitationCount !== 0)
    reasons.push('INVITATION_BY_EMAIL_EXISTS_OR_UNKNOWN');

  const refs = snapshot?.references;
  if (!Array.isArray(refs)) reasons.push('FK_INSPECTION_UNAVAILABLE');
  else for (const ref of refs) {
    if (!ref || typeof ref.table !== 'string' || typeof ref.column !== 'string' ||
      !Number.isInteger(ref.count) || ref.count < 0 || ref.unsupported) {
      reasons.push('UNSUPPORTED_FK_SHAPE');
      continue;
    }
    const allowedProjection = ref.table === 'reserve.users' && ref.column === 'id'
      && ref.parent === 'auth.users' && ref.count === 1;
    const allowedProfile = ref.table === 'public.profiles' && ref.column === 'id'
      && ref.parent === 'auth.users' && ref.count <= 1;
    if (!allowedProjection && !allowedProfile && ref.count > 0)
      reasons.push(`PROTECTED_REFERENCE:${ref.table}.${ref.column}`);
  }

  if (!Array.isArray(snapshot?.schemaTables) || !snapshot.schemaTables.length)
    reasons.push('SCHEMA_FINGERPRINT_UNAVAILABLE');
  const uniqueReasons = [...new Set(reasons)].sort();
  const impact = {
    authIdentities: 1,
    reserveProjections: snapshot?.reserveProjectionCount ?? null,
    profileRows: refs?.find(r => r.table === 'public.profiles' && r.column === 'id')?.count ?? null,
    membershipsOrAuditRemoved: 0,
  };
  const canonical = {request:{id:request?.id,email:request?.email?.toLowerCase(),fixture:request?.fixture},
    snapshot,impact,reasonCodes:uniqueReasons};
  return {
    status: uniqueReasons.length ? 'BLOCKED' : 'ELIGIBLE',
    reasons: uniqueReasons, impact,
    sha256: sha256(JSON.stringify(canonical)),
  };
}

export function approveSyntheticCleanup(plan, { id, email, expectedHash, confirmation, reason }) {
  if (plan?.status !== 'ELIGIBLE') return 'PLAN_BLOCKED';
  if (!SHA256.test(expectedHash || '') || expectedHash !== plan.sha256) return 'PLAN_HASH_MISMATCH';
  if (confirmation !== `DELETE TEST ACCOUNT ${id}`) return 'EXPLICIT_CONFIRMATION_REQUIRED';
  if (!/^[^\s@]+@example\.invalid$/i.test(email || '')) return 'NON_SYNTHETIC_EMAIL';
  if (typeof reason !== 'string' || reason.trim().length < 15 || reason.length > 500)
    return 'MEANINGFUL_REASON_REQUIRED';
  return null;
}

function localUrl(name, raw, protocols) {
  assert.ok(raw, `${name} required`);
  const url = new URL(raw);
  assert.ok(protocols.includes(url.protocol), `${name} protocol rejected`);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), `${name} MUST be loopback`);
  assert.ok(+url.port >= 20000 && +url.port <= 32767, `${name} disposable port required`);
  return url;
}

function sql(db, statement) {
  const result=spawnSync('psql',[db.href,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
    '-v','VERBOSITY=terse','-f','-'],{
    input:statement,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
  });
  if (result.status !== 0) throw new Error('LOCAL_DATABASE_OPERATION_FAILED');
  return result.stdout.trim();
}
function scalar(db, statement) { return sql(db,statement).trim(); }
function json(db, statement) { return JSON.parse(scalar(db,statement)); }

function inspect(db, request) {
  const id=quoted(request.id), email=quoted(request.email.toLowerCase());
  const account=json(db,`SELECT coalesce((SELECT json_build_object(
    'id',id,'email',email,'fixture',raw_app_meta_data->>'veni_synthetic_fixture')
    FROM auth.users WHERE id=${id}::uuid)::text,'null');`);
  const reserveProjectionCount=Number(scalar(db,`SELECT count(*) FROM reserve.users WHERE id=${id}::uuid;`));
  const emailInvitationCount=Number(scalar(db,`SELECT count(*) FROM reserve_internal.invitations
    WHERE target_email=${email};`));
  const schemaTables=json(db,`SELECT coalesce(json_agg(n.nspname||'.'||c.relname ORDER BY
    n.nspname,c.relname),'[]'::json)::text FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','reserve','reserve_internal');`);
  const inbound=json(db,`SELECT coalesce(json_agg(row_to_json(f) ORDER BY f.parent,f.tbl,f.col),'[]'::json)::text
    FROM (SELECT np.nspname||'.'||p.relname parent,
      nr.nspname||'.'||r.relname tbl,
      a.attname col, array_length(c.conkey,1) ncols,
      array_length(c.confkey,1) nrefcols
    FROM pg_constraint c
    JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace nr ON nr.oid=r.relnamespace
    JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace np ON np.oid=p.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid IN ('auth.users'::regclass,'reserve.users'::regclass)
      AND nr.nspname NOT IN ('auth','storage','vault','realtime','extensions','pg_catalog')
    ) f;`);
  const references=[];
  for(const f of inbound) {
    const [schema,table]=String(f.tbl).split('.');
    const supported=IDENT.test(schema||'') && IDENT.test(table||'') &&
      IDENT.test(f.col||'') && f.ncols===1 && f.nrefcols===1;
    const count=supported ? Number(scalar(db,
      `SELECT count(*) FROM "${schema}"."${table}" WHERE "${f.col}"=${id}::uuid;`)) : null;
    references.push({table:f.tbl,column:f.col,parent:f.parent,count,unsupported:!supported});
  }
  return {account,reserveProjectionCount,emailInvitationCount,references,schemaTables};
}

function receipt(db, {outcome,operator,reason,request,planHash,detail}) {
  assert.ok(ALLOWED_OUTCOMES.has(outcome));
  const auditId=randomUUID();
  const emailHash=sha256(request.email.toLowerCase());
  const detailJson=JSON.stringify(detail??{});
  sql(db,`INSERT INTO venicleanup_ci.receipts
    (event_id,outcome,operator_id,reason,target_auth_id,target_email_sha256,plan_sha256,detail)
    VALUES (${quoted(auditId)}::uuid,${quoted(outcome)},${quoted(operator)},${quoted(reason)},
      ${quoted(request.id)}::uuid,${quoted(emailHash)},${quoted(planHash)},${quoted(detailJson)}::jsonb);`);
  return auditId;
}

function removeUnassignedProjection(db, request) {
  const id=quoted(request.id),email=quoted(request.email.toLowerCase());
  const fixture=quoted(request.fixture);
  // SERIALIZABLE and FKs are a second guard against a dependency appearing
  // after the preview. No triggers, constraints or Reserve audit are bypassed.
  sql(db,`BEGIN ISOLATION LEVEL SERIALIZABLE;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${id}::uuid
          AND lower(email)=${email}
          AND raw_app_meta_data->>'veni_synthetic_fixture'=${fixture})
      THEN RAISE EXCEPTION 'Identity no longer matches synthetic marker'; END IF;
      IF EXISTS(SELECT 1 FROM reserve_internal.invitations WHERE target_email=${email})
      THEN RAISE EXCEPTION 'An invitation now references the email'; END IF;
      IF EXISTS(SELECT 1 FROM reserve.memberships WHERE user_id=${id}::uuid)
      THEN RAISE EXCEPTION 'Membership now references identity'; END IF;
      DELETE FROM reserve.users WHERE id=${id}::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reserve projection no longer exists'; END IF;
    END $$;
    COMMIT;`);
}

async function deleteFromLocalAuth(api,adminKey,request) {
  const response=await fetch(new URL(`/auth/v1/admin/users/${request.id}`,api),{
    method:'DELETE',headers:{apikey:adminKey,authorization:`Bearer ${adminKey}`},
    signal:AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error('LOCAL_AUTH_ADMIN_DELETE_FAILED');
}

function parseArgs(argv) {
  const options={};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if (!k.startsWith('--') || ![
      '--plan','--execute','--account-id','--email','--fixture',
      '--approve-hash','--confirm','--reason'
    ].includes(k)) throw new Error('UNKNOWN_OR_MISSING_ARGUMENT');
    if (k==='--plan'||k==='--execute') {options[k.slice(2)]=true;continue;}
    if (!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('MISSING_ARGUMENT_VALUE');
    options[k.slice(2)]=argv[++i];
  }
  return options;
}

async function main() {
  if(process.argv.includes('--help')) {
    console.log('LOCAL CI ONLY: --plan|--execute --account-id UUID --email user@example.invalid --fixture CI_NONCE [--approve-hash SHA256 --confirm "DELETE TEST ACCOUNT UUID" --reason "..."]');
    return;
  }
  assert.equal(process.env.CI,'true','CI runner required');
  assert.equal(process.env.VENI_ATOMIC_RESERVE_REHEARSAL,'yes');
  assert.equal(process.env.VENI_SYNTHETIC_CLEANUP_TEST_ONLY,'yes');
  const db=localUrl('TARGET_DB_URL',process.env.TARGET_DB_URL,['postgres:','postgresql:']);
  const api=localUrl('TARGET_API_URL',process.env.TARGET_API_URL,['http:']);
  assert.equal(db.pathname,'/postgres');
  const operator=process.env.VENI_SYNTHETIC_OPERATOR_ID;
  assert.ok(/^ci:[a-z0-9_-]{5,80}$/.test(operator||''),'Named synthetic service operator required');

  const o=parseArgs(process.argv.slice(2));
  assert.ok(o.plan!==o.execute,'Specify exactly one of --plan and --execute');
  assert.ok(UUID.test(o['account-id']||''),'Explicit UUID required');
  assert.ok(/^[^\s@]+@example\.invalid$/i.test(o.email||''),'Synthetic .invalid email required');
  assert.ok(/^[a-zA-Z0-9_-]{12,100}$/.test(o.fixture||''),'Current CI fixture nonce required');
  const request={id:o['account-id'],email:o.email,fixture:o.fixture};
  const snapshot=inspect(db,request);
  const plan=planSyntheticReserveCleanup(snapshot,request);
  if(o.plan){console.log(JSON.stringify({mode:'DRY_RUN',...plan,targetId:request.id}));return;}

  const reason=o.reason||'';
  const refusal=approveSyntheticCleanup(plan,{id:request.id,email:request.email,
    expectedHash:o['approve-hash'],confirmation:o.confirm,reason});
  if(refusal){
    const eventId=receipt(db,{outcome:'DENIED',operator,reason:'Attempt denied by plan/approval gate',
      request,planHash:plan.sha256,detail:{refusal,reasonCodes:plan.reasons}});
    console.log(JSON.stringify({status:'DENIED',code:refusal,eventId}));
    process.exitCode=2;return;
  }

  // This is never the public service_role. The key must be generated by the
  // exact disposable local Supabase CLI instance inspected above.
  const adminKey=process.env.TARGET_SERVICE_ROLE_KEY;
  assert.ok(adminKey && adminKey.length>20,'Local-only admin key required');
  const preparedId=receipt(db,{outcome:'PREPARED',operator,reason,request,
    planHash:plan.sha256,detail:{impact:plan.impact}});
  try {
    const fresh=planSyntheticReserveCleanup(inspect(db,request),request);
    if(fresh.status!=='ELIGIBLE'||fresh.sha256!==plan.sha256)
      throw new Error('PLAN_CHANGED_AFTER_APPROVAL');
    removeUnassignedProjection(db,request);
    await deleteFromLocalAuth(api,adminKey,request);
    const succeededId=receipt(db,{outcome:'SUCCEEDED',operator,reason,request,
      planHash:plan.sha256,detail:{preparedId,authDeletionConfirmed:true}});
    console.log(JSON.stringify({status:'DELETED',targetId:request.id,preparedId,succeededId}));
  } catch (e) {
    // If Auth itself still exists, a missing projection can be restored. This
    // preserves the identity graph for a future reviewed retry.
    let compensated=false;
    try {
      const exists=scalar(db,`SELECT count(*) FROM auth.users WHERE id=${quoted(request.id)}::uuid;`);
      if(exists==='1') {
        sql(db,`INSERT INTO reserve.users(id) VALUES (${quoted(request.id)}::uuid)
          ON CONFLICT (id) DO NOTHING;`);
        compensated=true;
      }
    } catch { /* leave an explicit failed audit for operator investigation */ }
    receipt(db,{outcome:compensated?'COMPENSATED':'FAILED',operator,reason,request,
      planHash:plan.sha256,detail:{preparedId,errorCode:e.message,requiresReview:!compensated}});
    throw new Error('SYNTHETIC_CLEANUP_NOT_COMPLETED');
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(e=>{console.error(JSON.stringify({status:'ERROR',code:e.message}));process.exitCode=1;});
}
