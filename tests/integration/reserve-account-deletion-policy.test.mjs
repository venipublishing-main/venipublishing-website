import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reserveDeletionDecision } from '../../supabase/functions/_shared/reserve-account-deletion-policy.mjs';

test('clean self-only Reserve preflight permits the existing Website deletion path', () => {
  assert.equal(reserveDeletionDecision('RESERVE_CLEAR', null), null);
});

test('active Reserve ownership requires explicit transfer and cannot call hard-delete', () => {
  assert.deepEqual(reserveDeletionDecision('OWNER_TRANSFER_REQUIRED', null), {
    status: 409,
    code: 'RESERVE_OWNER_TRANSFER_REQUIRED',
    error: 'Please transfer your Reserve business ownership before requesting account deletion.',
  });
});

test('any remaining Reserve history blocks direct auth.users deletion', () => {
  assert.equal(reserveDeletionDecision('RESERVE_HISTORY_REVIEW_REQUIRED', null)?.status, 409);
});

test('missing claims, RPC failures and unknown values fail closed', () => {
  assert.equal(reserveDeletionDecision('REAUTH_REQUIRED', null)?.status, 401);
  assert.equal(reserveDeletionDecision('RESERVE_CLEAR', new Error('misconfigured'))?.status, 503);
  assert.equal(reserveDeletionDecision(undefined, null)?.status, 503);
  assert.equal(reserveDeletionDecision('UNKNOWN_VERSION', null)?.status, 503);
  assert.equal(reserveDeletionDecision(null, null)?.status, 503);
});
