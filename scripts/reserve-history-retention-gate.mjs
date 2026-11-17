// DRAFT / CI-ONLY decision model. This module NEVER changes Auth, Reserve,
// entitlements or audit data, and it is NOT an administrator API endpoint.
import { createHash } from 'node:crypto';
import { planSyntheticReserveCleanup } from './reserve-test-account-operator.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set(['ACTIVE', 'SUSPENDED', 'REVOKED']);
const HOLD_NAMES = ['legal', 'dispute', 'financial', 'security', 'unknown'];
const SHA256 = /^[0-9a-f]{64}$/;

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = values => [...new Set(values)].sort();

function checkVerifiedSnapshot(snapshot, request) {
  const issues=[];
  if (!UUID.test(request?.id ?? '') ||
    !/^[^\s@]+@example\.invalid$/i.test(request?.email ?? '') ||
    !/^[a-zA-Z0-9_-]{12,100}$/.test(request?.fixture ?? ''))
    issues.push('NOT_EXACT_SYNTHETIC_TARGET');
  if (snapshot?.account?.id !== request?.id ||
    snapshot?.account?.email?.toLowerCase() !== request?.email?.toLowerCase() ||
    snapshot?.account?.fixture !== request?.fixture)
    issues.push('TRUSTED_AUTH_IDENTITY_NOT_VERIFIED');
  if (snapshot?.reserveProjectionCount !== 1) issues.push('RESERVE_PROJECTION_NOT_VERIFIED');
  if (!Array.isArray(snapshot?.schemaTables) || snapshot.schemaTables.length===0 ||
    !Array.isArray(snapshot?.references)) issues.push('SCHEMA_OR_FK_INVENTORY_MISSING');
  else {
    for (const ref of snapshot.references) {
      if (!ref || typeof ref.table!=='string' || typeof ref.column!=='string' ||
        !['auth.users','reserve.users'].includes(ref.parent) ||
        !Number.isSafeInteger(ref.count) || ref.count<0 || ref.unsupported)
        issues.push('UNSUPPORTED_REFERENCE');
    }
  }
  if (!Number.isSafeInteger(snapshot?.emailInvitationCount) || snapshot.emailInvitationCount<0)
    issues.push('INVITATION_EMAIL_COUNT_UNKNOWN');
  if (!Array.isArray(snapshot?.memberships)) issues.push('MEMBERSHIP_INVENTORY_MISSING');
  else {
    const seen=new Set();
    for (const m of snapshot.memberships) {
      if (!UUID.test(m?.id??'') || !UUID.test(m?.tenantId??'') ||
        !STATES.has(m?.status) || typeof m?.ownerRole!=='boolean' || seen.has(m?.id))
        issues.push('MEMBERSHIP_OR_OWNER_ROLE_UNKNOWN');
      if (m?.id) seen.add(m.id);
    }
    const count=snapshot.references?.filter(r=>r.table==='reserve.memberships' &&
      r.column==='user_id' && r.parent==='reserve.users').reduce((s,r)=>s+r.count,0);
    if (!Number.isSafeInteger(count) || count!==snapshot.memberships.length)
      issues.push('MEMBERSHIP_COUNTS_DIVERGE');
  }
  // This is an explicit evidence inventory. No absence-by-omission is accepted.
  if (!snapshot?.productInventory ||
    !['website','arcana','performance','reserve','billing','other'].every(k=>
      Number.isSafeInteger(snapshot.productInventory[k]) && snapshot.productInventory[k]>=0))
    issues.push('CROSS_PRODUCT_INVENTORY_MISSING');
  if (!Array.isArray(snapshot?.dependencyTenantIds) ||
    !snapshot.dependencyTenantIds.every(id=>UUID.test(id)) ||
    (Array.isArray(snapshot?.memberships)?snapshot.memberships:[]).some(m=>
      UUID.test(m?.tenantId??'') && !snapshot.dependencyTenantIds.includes(m.tenantId)))
    issues.push('DEPENDENCY_TENANT_SCOPE_UNKNOWN');
  if (!snapshot?.holds || !HOLD_NAMES.every(k=>typeof snapshot.holds[k]==='boolean'))
    issues.push('RETENTION_HOLDS_UNKNOWN');
  return unique(issues);
}

/**
 * An inventory-based, non-mutating proposal. Even a reviewed outcome cannot
 * grant hard deletion. Real snapshots must be independently gathered server-side.
 */
export function planReserveHistoricalDisposition(snapshot, request) {
  const issues=checkVerifiedSnapshot(snapshot,request);
  const delegate=planSyntheticReserveCleanup(snapshot,request);
  const memberships=Array.isArray(snapshot?.memberships)?snapshot.memberships:[];
  const activeOwner=memberships.some(m=>m.status==='ACTIVE' && m.ownerRole===true);
  const activeMembership=memberships.some(m=>m.status==='ACTIVE');
  const knownHold=HOLD_NAMES.some(k=>snapshot?.holds?.[k]===true);
  const relatedProducts=Object.entries(snapshot?.productInventory??{})
    .filter(([k,n])=>k!=='reserve' && Number.isInteger(n) && n>0).map(([k])=>k).sort();
  const references=Array.isArray(snapshot?.references)?snapshot.references:[];
  const protectedRefs=references.filter(r=>r.count>0 && !(
    (r.table==='reserve.users' && r.column==='id' && r.parent==='auth.users') ||
    (r.table==='public.profiles' && r.column==='id' && r.parent==='auth.users')
  ));
  let disposition='INVENTORY_BLOCKED';
  let nextStep='STOP_AND_RECHECK_INVENTORY';
  if (issues.length===0) {
    if (delegate.status==='ELIGIBLE' && memberships.length===0 && !knownHold &&
      relatedProducts.length===0 && snapshot.productInventory.reserve===0) {
      disposition='EXISTING_SYNTHETIC_OPERATOR';
      nextStep='USE_SEPARATE_PR10_OPERATOR_GATE';
    } else if (activeOwner) {
      disposition='OWNERSHIP_HOLD';
      nextStep='TRANSFER_OWNERSHIP_WITH_EXISTING_RESERVE_INVARIANTS_FIRST';
    } else if (knownHold) {
      disposition='RETENTION_HOLD';
      nextStep='RETAIN_REFERENCES_AND_RESTRICT_PROCESSING';
    } else {
      disposition='HISTORY_REVIEW';
      nextStep=activeMembership?'REVIEW_ACCESS_REVOCATION_AND_RETENTION':
        'REVIEW_DEIDENTIFICATION_WITH_IMMUTABLE_HISTORY';
    }
  }
  const impactedTenants=unique(memberships.filter(m=>UUID.test(m?.tenantId??''))
    .map(m=>m.tenantId).concat((snapshot?.dependencyTenantIds??[]).filter(id=>UUID.test(id))));
  const plan={
    targetId:request?.id??null,
    status:disposition, nextStep,
    destructiveExecutionAllowed:false,
    issues,
    facts:{
      membershipCount:memberships.length,activeOwner,activeMembership,
      invitationCount:snapshot?.emailInvitationCount??null,
      protectedReferenceKinds:unique(protectedRefs.map(r=>`${r.table}.${r.column}`)),
      relatedProducts,impactedTenants,
      hasKnownRetentionHold:knownHold,
      // A stable UUID linked to immutable audit is still potentially personal
      // data. This is never evidence of complete anonymisation.
      historicIdentifiersMayRemainLinkable:protectedRefs.length>0 || memberships.length>0,
    },
  };
  return {...plan,sha256:digest({request,snapshot,plan})};
}

function verifiedReviewer(reviewer, targetId, impactedTenants, relatedProducts, nowMs) {
  if (!reviewer || !UUID.test(reviewer.id??'') || reviewer.id===targetId ||
    reviewer.source!=='trusted_server_session' ||
    reviewer.permission!=='veni.platform.privacy_review' ||
    reviewer.aal!=='aal2' || reviewer.role!=='human' ||
    !Number.isFinite(reviewer.reauthenticatedAtMs) ||
    reviewer.reauthenticatedAtMs>nowMs ||
    nowMs-reviewer.reauthenticatedAtMs>300_000 ||
    !Array.isArray(reviewer.allowedTenantIds) ||
    !impactedTenants.every(id=>reviewer.allowedTenantIds.includes(id)) ||
    !Array.isArray(reviewer.allowedProducts) ||
    !['reserve',...relatedProducts].every(p=>reviewer.allowedProducts.includes(p))) return false;
  return true;
}

/**
 * Validate MOCKED review evidence in tests only. Passing this gate creates
 * NO right to modify databases, delete users or de-identify records.
 */
export function reviewHistoricalPlan(plan, evidence, nowMs) {
  if (plan?.status!=='HISTORY_REVIEW' || plan.destructiveExecutionAllowed!==false)
    return {status:'REJECTED',reason:'NOT_REVIEWABLE'};
  if (!Number.isSafeInteger(nowMs) || nowMs<=0)
    return {status:'REJECTED',reason:'INVALID_REVIEW_TIME'};
  if (!SHA256.test(evidence?.expectedPlanHash??'') || evidence.expectedPlanHash!==plan.sha256)
    return {status:'REJECTED',reason:'PLAN_HASH_MISMATCH'};
  if (evidence.confirmation!==`REVIEW HISTORICAL TEST ACCOUNT ${evidence.targetId}` ||
    !UUID.test(evidence.targetId??'') || evidence.targetId!==plan.targetId)
    return {status:'REJECTED',reason:'EXPLICIT_TARGET_CONFIRMATION_REQUIRED'};
  const {requester,approver}=evidence??{};
  if (!verifiedReviewer(requester,evidence.targetId,plan.facts.impactedTenants,
    plan.facts.relatedProducts,nowMs) ||
    !verifiedReviewer(approver,evidence.targetId,plan.facts.impactedTenants,
      plan.facts.relatedProducts,nowMs) ||
    requester.id===approver.id)
    return {status:'REJECTED',reason:'TWO_INDEPENDENT_FRESH_AAL2_REVIEWERS_REQUIRED'};
  if (!evidence.retentionReview || evidence.retentionReview.reviewedBy!==approver.id ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(evidence.retentionReview.policyCaseId??'') ||
    !['RETAIN','DEIDENTIFICATION_ASSESSMENT'].includes(evidence.retentionReview.decision) ||
    evidence.retentionReview.holdCleared!==true ||
    typeof evidence.reason!=='string' || evidence.reason.trim().length<20 ||
    evidence.reason.length>500)
    return {status:'REJECTED',reason:'DOCUMENTED_RETENTION_DECISION_REQUIRED'};
  return {
    status:'REVIEW_PACKET_ACCEPTED',
    nextStep:plan.nextStep,
    destructiveExecutionAllowed:false,
    // Actual action requires independent server-side permission validation,
    // linked-identity/tenant review and a *separate* approved implementation.
    executionCapability:null,
    planSha256:plan.sha256,
    reviewerIds:[requester.id,approver.id],
    policyCaseId:evidence.retentionReview.policyCaseId,
  };
}
