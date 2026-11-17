import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planReserveHistoricalDisposition, reviewHistoricalPlan } from
  '../../scripts/reserve-history-retention-gate.mjs';

const targetId='b1111111-1111-4111-8111-111111111111';
const tenantA='c1111111-1111-4111-8111-111111111111';
const tenantB='c2222222-2222-4222-8222-222222222222';
const requesterId='b2222222-2222-4222-8222-222222222222';
const approverId='b3333333-3333-4333-8333-333333333333';
const fixture='synthetic_history_20261117';
const request={id:targetId,email:'linked-test@example.invalid',fixture};
const membershipId='b4444444-4444-4444-8444-444444444444';
const nowMs=Date.UTC(2026,10,17,6,0,0);

function snapshot() {return {
  account:{id:targetId,email:request.email,fixture},
  reserveProjectionCount:1,emailInvitationCount:0,
  schemaTables:['public.profiles','reserve.users','reserve.memberships','reserve.audit_events'],
  references:[
    {table:'reserve.users',column:'id',parent:'auth.users',count:1},
    {table:'public.profiles',column:'id',parent:'auth.users',count:1},
    {table:'reserve.memberships',column:'user_id',parent:'reserve.users',count:0},
    {table:'reserve.audit_events',column:'actor_user_id',parent:'reserve.users',count:0},
  ],
  memberships:[],dependencyTenantIds:[],
  // "reserve" counts other domain records, not the single identity projection.
  productInventory:{website:0,arcana:0,performance:0,reserve:0,billing:0,other:0},
  holds:{legal:false,dispute:false,financial:false,security:false,unknown:false},
};}
function linked({status='REVOKED',ownerRole=false,auditCount=1}={}){
  const s=snapshot();
  s.memberships=[{id:membershipId,tenantId:tenantA,status,ownerRole}];
  s.dependencyTenantIds=[tenantA];
  s.references[2].count=1;
  s.references[3].count=auditCount;
  return s;
}

function reviewer(id,allowedTenantIds=[tenantA],allowedProducts=['reserve']){
  return {id,role:'human',source:'trusted_server_session',
    permission:'veni.platform.privacy_review',aal:'aal2',
    reauthenticatedAtMs:nowMs-60_000,allowedTenantIds,allowedProducts};
}
function evidence(plan){return {
  expectedPlanHash:plan.sha256,targetId,
  confirmation:`REVIEW HISTORICAL TEST ACCOUNT ${targetId}`,
  requester:reviewer(requesterId),approver:reviewer(approverId),
  retentionReview:{reviewedBy:approverId,policyCaseId:'POPIA_CASE_20261117',
    decision:'DEIDENTIFICATION_ASSESSMENT',holdCleared:true},
  reason:'Assess identity minimisation and preserve tenant audit history',
};}

test('unassigned synthetic identity only delegates to existing PR10 gate',()=>{
  const p=planReserveHistoricalDisposition(snapshot(),request);
  assert.equal(p.status,'EXISTING_SYNTHETIC_OPERATOR');
  assert.equal(p.nextStep,'USE_SEPARATE_PR10_OPERATOR_GATE');
  assert.equal(p.destructiveExecutionAllowed,false);
  assert.match(p.sha256,/^[a-f0-9]{64}$/);
});

test('historical membership (even revoked) and immutable audit require review',()=>{
  const p=planReserveHistoricalDisposition(linked(),request);
  assert.equal(p.status,'HISTORY_REVIEW');
  assert.equal(p.nextStep,'REVIEW_DEIDENTIFICATION_WITH_IMMUTABLE_HISTORY');
  assert.deepEqual(p.facts.protectedReferenceKinds,
    ['reserve.audit_events.actor_user_id','reserve.memberships.user_id']);
  assert.equal(p.facts.historicIdentifiersMayRemainLinkable,true);
  assert.deepEqual(p.facts.impactedTenants,[tenantA]);
  assert.equal(p.destructiveExecutionAllowed,false);
});

test('active member needs access-revocation review; active owner is held',()=>{
  const staff=planReserveHistoricalDisposition(linked({status:'ACTIVE'}),request);
  assert.equal(staff.status,'HISTORY_REVIEW');
  assert.equal(staff.nextStep,'REVIEW_ACCESS_REVOCATION_AND_RETENTION');
  const owner=planReserveHistoricalDisposition(linked({status:'ACTIVE',ownerRole:true}),request);
  assert.equal(owner.status,'OWNERSHIP_HOLD');
  assert.equal(owner.destructiveExecutionAllowed,false);
  assert.equal(reviewHistoricalPlan(owner,evidence(owner),nowMs).status,'REJECTED');
});

test('retention, financial, legal or unresolved dispute holds fail closed',()=>{
  for(const hold of ['legal','dispute','financial','security','unknown']){
    const s=linked();s.holds[hold]=true;
    const p=planReserveHistoricalDisposition(s,request);
    assert.equal(p.status,'RETENTION_HOLD',hold);
    assert.equal(p.nextStep,'RETAIN_REFERENCES_AND_RESTRICT_PROCESSING');
    assert.equal(reviewHistoricalPlan(p,evidence(p),nowMs).status,'REJECTED');
  }
});

test('unknown marker, incomplete inventory, role mismatch and future FK are safe',()=>{
  const candidates=[];
  const a=linked();a.account.fixture=null;candidates.push(a);
  const b=linked();delete b.productInventory.arcana;candidates.push(b);
  const c=linked();c.references[2].count=0;candidates.push(c);
  const d=linked();d.memberships[0].ownerRole=undefined;candidates.push(d);
  const e=linked();e.references.push({table:'reserve.future',column:'customer_id',
    parent:'reserve.users',unsupported:true,count:null});candidates.push(e);
  const f=linked();f.dependencyTenantIds=[];candidates.push(f);
  const g=linked();delete g.holds.legal;candidates.push(g);
  const h=linked();h.memberships={untrusted:'malformed'};candidates.push(h);
  const i=linked();i.references.push(null);candidates.push(i);
  for(const s of candidates){
    const p=planReserveHistoricalDisposition(s,request);
    assert.equal(p.status,'INVENTORY_BLOCKED',JSON.stringify(p.issues));
    assert.equal(p.destructiveExecutionAllowed,false);
  }
  assert.equal(planReserveHistoricalDisposition(null,request).status,'INVENTORY_BLOCKED');
});

test('invitation-only or another product link cannot trigger unassigned cleanup',()=>{
  const invitation=snapshot();invitation.emailInvitationCount=1;
  invitation.dependencyTenantIds=[tenantB];
  const invitePlan=planReserveHistoricalDisposition(invitation,request);
  assert.equal(invitePlan.status,'HISTORY_REVIEW');
  assert.equal(invitePlan.facts.historicIdentifiersMayRemainLinkable,true);
  const arcana=snapshot();arcana.productInventory.arcana=1;
  const arcanaPlan=planReserveHistoricalDisposition(arcana,request);
  assert.equal(arcanaPlan.status,'HISTORY_REVIEW');
  assert.equal(arcanaPlan.facts.historicIdentifiersMayRemainLinkable,true);
});

test('each changed dependency or scope produces a different review fingerprint',()=>{
  const base=linked();
  const p1=planReserveHistoricalDisposition(base,request);
  const p2=planReserveHistoricalDisposition(linked(),request);
  assert.equal(p1.sha256,p2.sha256);
  base.references[3].count++;
  assert.notEqual(planReserveHistoricalDisposition(base,request).sha256,p1.sha256);
  base.references[3].count--;
  base.dependencyTenantIds.push(tenantB);
  assert.notEqual(planReserveHistoricalDisposition(base,request).sha256,p1.sha256);
});

test('two separate recent human AAL2 reviewers produce only a review packet',()=>{
  const plan=planReserveHistoricalDisposition(linked(),request);
  const result=reviewHistoricalPlan(plan,evidence(plan),nowMs);
  assert.equal(result.status,'REVIEW_PACKET_ACCEPTED');
  assert.equal(result.destructiveExecutionAllowed,false);
  assert.equal(result.executionCapability,null);
  assert.deepEqual(result.reviewerIds,[requesterId,approverId]);
  assert.equal(reviewHistoricalPlan({status:'HISTORY_REVIEW',
    destructiveExecutionAllowed:false},evidence(plan),nowMs).status,'REJECTED');
});

test('mocked review rejects wrong target, hash, confirmation and decision',()=>{
  const p=planReserveHistoricalDisposition(linked(),request);
  for(const modify of [
    e=>{e.expectedPlanHash='0'.repeat(64);},
    e=>{e.targetId=tenantB;},
    e=>{e.confirmation='DELETE ALL';},
    e=>{e.reason='ok';},
    e=>{e.retentionReview.policyCaseId='';},
    e=>{e.retentionReview.reviewedBy=requesterId;},
    e=>{e.retentionReview.holdCleared=false;},
  ]){
    const e=evidence(p);modify(e);
    assert.equal(reviewHistoricalPlan(p,e,nowMs).status,'REJECTED');
  }
});

test('mocked review rejects single operator, stale/MFA-less/unscoped sessions',()=>{
  const p=planReserveHistoricalDisposition(linked(),request);
  for(const modify of [
    e=>{e.approver.id=requesterId;},
    e=>{e.approver.id=targetId;},
    e=>{e.approver.aal='aal1';},
    e=>{e.approver.role='service';},
    e=>{e.requester.source='client_claim';},
    e=>{e.approver.permission='tenant.members.manage';},
    e=>{e.approver.reauthenticatedAtMs=nowMs-300_001;},
    e=>{e.approver.reauthenticatedAtMs=nowMs+1;},
    e=>{e.approver.allowedTenantIds=[];},
    e=>{e.approver.allowedProducts=[];},
  ]){
    const e=evidence(p);modify(e);
    assert.equal(reviewHistoricalPlan(p,e,nowMs).status,'REJECTED');
  }
});

test('multi-tenant or cross-product dependencies need both scopes',()=>{
  const s=linked();s.dependencyTenantIds.push(tenantB);s.productInventory.arcana=1;
  const p=planReserveHistoricalDisposition(s,request);
  let e=evidence(p);
  assert.equal(reviewHistoricalPlan(p,e,nowMs).status,'REJECTED');
  e.requester.allowedTenantIds=[tenantA,tenantB];
  e.approver.allowedTenantIds=[tenantA,tenantB];
  e.requester.allowedProducts=['reserve','arcana'];
  e.approver.allowedProducts=['reserve','arcana'];
  assert.equal(reviewHistoricalPlan(p,e,nowMs).status,'REVIEW_PACKET_ACCEPTED');
  assert.equal(reviewHistoricalPlan(p,e,nowMs).destructiveExecutionAllowed,false);
});
