import { reserveDeletionDecision } from './reserve-account-deletion-policy.mjs';

const denied = (status, code, error) => ({ status, body: { code, error } });
const unavailable = () => denied(503, 'ACCOUNT_DELETION_PREFLIGHT_UNAVAILABLE',
  'Account deletion is temporarily unavailable. Please try again later.');

// Side-effecting callbacks are supplied by the Edge Function, never the caller.
// A disposable Website-only identity may be deleted; any Reserve ownership,
// projection, unknown preflight state or failed password check denies deletion.
export async function guardedAccountDeletion({
  enabled, user, requestBody, checkActiveSession, runPreflight,
  reauthenticate, deleteAuthenticatedUser,
}) {
  if (!user?.id) return denied(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');

  // Critically, an unset flag does NOT skip checks. Shared Reserve must be
  // installed, verified and explicitly enabled before any hard deletion.
  if (enabled !== 'enabled') return unavailable();

  const validBody = requestBody !== null && typeof requestBody === 'object'
    && !Array.isArray(requestBody)
    && Object.keys(requestBody).every(key => key === 'confirmation' || key === 'password')
    && requestBody.confirmation === 'DELETE MY ACCOUNT'
    && typeof requestBody.password === 'string'
    && requestBody.password.length > 0 && requestBody.password.length <= 1024;
  if (!validBody) return denied(400, 'DELETE_CONFIRMATION_REQUIRED',
    'Type DELETE MY ACCOUNT and provide your current password.');

  // A signed access token can remain cryptographically valid after logout or
  // session revocation. The server must check the JWT's *own* session_id
  // against current auth.sessions, without accepting an ID from request JSON.
  // An absent/malformed/unavailable checker MUST NOT permit hard deletion.
  const requireActiveSession = async () => {
    if (typeof checkActiveSession !== 'function') {
      return denied(503, 'ACCOUNT_SESSION_CHECK_UNAVAILABLE',
        'We could not verify your active session. Your account was not deleted.');
    }
    try {
      const result = await checkActiveSession();
      if (result?.error || (result?.data !== true && result?.data !== false)) {
        return denied(503, 'ACCOUNT_SESSION_CHECK_UNAVAILABLE',
          'We could not verify your active session. Your account was not deleted.');
      }
      if (result.data === false) {
        return denied(401, 'ACCOUNT_SESSION_NOT_ACTIVE',
          'This session has ended. Please sign in again. Your account was not deleted.');
      }
      return null;
    } catch {
      return denied(503, 'ACCOUNT_SESSION_CHECK_UNAVAILABLE',
        'We could not verify your active session. Your account was not deleted.');
    }
  };

  const initialSession = await requireActiveSession();
  if (initialSession) return initialSession;

  const preflight = async () => {
    try {
      const { data, error } = await runPreflight();
      const decision = reserveDeletionDecision(data, error);
      return decision ? { status: decision.status, body: {
        code: decision.code, error: decision.error,
      } } : null;
    } catch {
      return unavailable();
    }
  };

  // Before asking Auth to verify a password, first reject Reserve owners and
  // accounts retaining history. Check again after re-auth, before hard delete.
  const firstCheck = await preflight();
  if (firstCheck) return firstCheck;

  if (typeof user.email !== 'string' || !user.email) {
    return denied(409, 'PASSWORD_REAUTH_UNAVAILABLE',
      'Password confirmation is not available for this account. Contact support.');
  }

  let verification;
  try {
    verification = await reauthenticate(user.email, requestBody.password);
  } catch {
    return denied(401, 'ACCOUNT_DELETION_REAUTH_FAILED',
      'Current password verification failed. Your account was not deleted.');
  }
  if (verification?.error || verification?.userId !== user.id || !verification?.hasSession) {
    return denied(401, 'ACCOUNT_DELETION_REAUTH_FAILED',
      'Current password verification failed. Your account was not deleted.');
  }

  // Recheck the *requesting* session after step-up: a password verification
  // creates a second session and must not revive a revoked original token.
  const finalSession = await requireActiveSession();
  if (finalSession) return finalSession;

  const finalCheck = await preflight();
  if (finalCheck) return finalCheck;

  try {
    const { error } = await deleteAuthenticatedUser(user.id);
    if (error) return denied(500, 'ACCOUNT_DELETION_FAILED',
      'We could not delete this account. Please try again.');
  } catch {
    return denied(500, 'ACCOUNT_DELETION_FAILED',
      'We could not delete this account. Please try again.');
  }
  return { status: 200, body: { deleted: true } };
}
