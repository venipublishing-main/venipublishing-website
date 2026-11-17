import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSyntheticReserveCleanup, approveSyntheticCleanup } from
  '../../scripts/reserve-test-account-operator.mjs';

const id='b1111111-1111-4111-8111-111111111111';
const email='synthetic-fixture@example.invalid';
const fixture='synthetic_run_20261117';
const request={id,email,fixture};
const full={
  account:{id,email,fixture},reserveProjectionCount:1,emailInvitationCount:0,
  schemaTables:['public.profiles','reserve.users','reserve.memberships','reserve.audit_events'],
  references:[
    {table:'reserve.users',column:'id',parent:'auth.users',count:1},
    {table:'public.profiles',column:'id',parent:'auth.users',count:1},
    {table:'reserve.memberships',column:'user_id',parent:'reserve.users',count:0},
    {table:'reserve.audit_events',column:'actor_user_id',parent:'reserve.users',count:0},
  ],
};
const snap=()=>structuredClone(full);

test('only a trusted, unassigned synthetic Reserve projection is eligible',()=>{
  const plan=planSyntheticReserveCleanup(snap(),request);
  assert.equal(plan.status,'ELIGIBLE');
  assert.deepEqual(plan.reasons,[]);
  assert.deepEqual(plan.impact,{authIdentities:1,reserveProjections:1,profileRows:1,membershipsOrAuditRemoved:0});
  assert.match(plan.sha256,/^[a-f0-9]{64}$/);
  assert.equal(plan.sha256,planSyntheticReserveCleanup(snap(),request).sha256);
});

test('missing or forged user_metadata marker never enables cleanup',()=>{
  const s=snap();s.account.fixture=null;
  s.account.user_metadata={veni_synthetic_fixture:fixture};
  const plan=planSyntheticReserveCleanup(s,request);
  assert.equal(plan.status,'BLOCKED');
  assert.ok(plan.reasons.includes('TRUSTED_FIXTURE_MARKER_MISSING'));
});

test('genuine email, mismatch, unknown account or missing projection are blocked',()=>{
  for(const [s,r] of [
    [snap(),{...request,email:'someone@venipublishing.co.za'}],
    [snap(),{...request,id:'c2222222-2222-4222-8222-222222222222'}],
    [{...snap(),account:null},request],
    [{...snap(),reserveProjectionCount:0},request],
  ]) assert.equal(planSyntheticReserveCleanup(s,r).status,'BLOCKED');
});

test('any membership, including revoked, or audit/role reference blocks',()=>{
  for(const dependent of ['reserve.memberships','reserve.audit_events','reserve.membership_roles']) {
    const s=snap();
    s.references.push({table:dependent,column:'user_id',parent:'reserve.users',count:1});
    const plan=planSyntheticReserveCleanup(s,request);
    assert.equal(plan.status,'BLOCKED');
    assert.ok(plan.reasons.some(x=>x.startsWith('PROTECTED_REFERENCE:')));
  }
});

test('email-only invitations and future linked records block deletion',()=>{
  const invite=snap();invite.emailInvitationCount=1;
  assert.equal(planSyntheticReserveCleanup(invite,request).status,'BLOCKED');
  const future=snap();future.references.push({
    table:'reserve.bookings',column:'customer_user_id',parent:'reserve.users',count:1,
  });
  assert.equal(planSyntheticReserveCleanup(future,request).status,'BLOCKED');
});

test('unsupported FK shapes and failed introspection fail closed',()=>{
  const bad=snap();bad.references.push({table:'reserve.memberships',column:null,
    parent:'reserve.users',count:null,unsupported:true});
  assert.equal(planSyntheticReserveCleanup(bad,request).status,'BLOCKED');
  assert.equal(planSyntheticReserveCleanup({...snap(),references:null},request).status,'BLOCKED');
  assert.equal(planSyntheticReserveCleanup({...snap(),schemaTables:[]},request).status,'BLOCKED');
});

test('two-step approval binds the exact plan hash, account and meaningful reason',()=>{
  const plan=planSyntheticReserveCleanup(snap(),request);
  const valid={id,email,expectedHash:plan.sha256,
    confirmation:`DELETE TEST ACCOUNT ${id}`,
    reason:'Disposable identity created exclusively by this isolated CI run'};
  assert.equal(approveSyntheticCleanup(plan,valid),null);
  assert.equal(approveSyntheticCleanup(plan,{...valid,expectedHash:'0'.repeat(64)}),'PLAN_HASH_MISMATCH');
  assert.equal(approveSyntheticCleanup(plan,{...valid,confirmation:'DELETE ALL USERS'}),
    'EXPLICIT_CONFIRMATION_REQUIRED');
  assert.equal(approveSyntheticCleanup(plan,{...valid,reason:'okay'}),'MEANINGFUL_REASON_REQUIRED');
  const changed=snap();changed.references[2].count=1;
  assert.equal(approveSyntheticCleanup(planSyntheticReserveCleanup(changed,request),valid),'PLAN_BLOCKED');
});
