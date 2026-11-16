// Pure response policy for the experimental shared-Reserve deletion preflight.
// The database decides self-only status using RLS; this maps known outcomes to
// stable HTTP responses. Unknown/missing results fail closed.

const deferred = Object.freeze({
  OWNER_TRANSFER_REQUIRED: {
    status: 409,
    code: 'RESERVE_OWNER_TRANSFER_REQUIRED',
    error: 'Please transfer your Reserve business ownership before requesting account deletion.',
  },
  RESERVE_HISTORY_REVIEW_REQUIRED: {
    status: 409,
    code: 'RESERVE_RECORDS_REVIEW_REQUIRED',
    error: 'Your Reserve records need a privacy and retention review before this account can be deleted.',
  },
  REAUTH_REQUIRED: {
    status: 401,
    code: 'REAUTHENTICATION_REQUIRED',
    error: 'Please sign in again before requesting account deletion.',
  },
});

const unavailable = Object.freeze({
  status: 503,
  code: 'ACCOUNT_DELETION_PREFLIGHT_UNAVAILABLE',
  error: 'Account deletion is temporarily unavailable. Please try again later.',
});

/** Returns null ONLY when Reserve history/ownership does not block deletion. */
export function reserveDeletionDecision(status, queryError) {
  if (queryError) return unavailable;
  if (status === 'RESERVE_CLEAR') return null;
  return deferred[status] ?? unavailable;
}
