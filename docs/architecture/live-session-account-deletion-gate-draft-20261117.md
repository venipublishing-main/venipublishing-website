# Draft: live-session revocation gate for Veni Account deletion (17 November 2026)

**Status:** synthetic CI experiment on a stacked draft branch, not a hosted migration, release or permission to delete real accounts. Depends on the earlier unmerged Website/Reserve Auth and account-deletion PRs #2–#11.

## Finding

Supabase Auth access JWTs remain cryptographically valid after sign-out/revocation until they expire; a successful `auth.getUser()` and a newly successful password sign-in are not sufficient proof that the **original requesting session** is still active. Supabase documents a `session_id` claim corresponding to `auth.sessions.id`: https://supabase.com/docs/guides/auth/sessions.

The PR #9 self-service deletion draft checks Reserve owner/history twice and verifies the password. This additive gate checks the initiating JWT's live session before any Reserve business check and again after password step-up, immediately before final preflight and privileged deletion.

## Prototype contract

- `public.veni_account_active_session()` is a **disposable CI SQL prototype**, NOT a shipped migration. It accepts **no arguments**, reads only `auth.uid()` and the verified request's `auth.jwt()->>'session_id'`, and returns a single boolean from `auth.sessions`, denying anonymous/malformed/unknown or time-box-expired sessions. It does not disclose another user's session, UUID, email or Auth row.
- It requires scoped `SECURITY DEFINER` to inspect non-exposed `auth.sessions`. Its `search_path` is empty; it uses schema-qualified relations, explicitly revokes default EXECUTE from PUBLIC, anon and service_role, and grants EXECUTE only to authenticated. Treat this as a privileged code-review surface; run Supabase security advisors before any production migration.
- The Edge Function calls this RPC with the **original user's** Authorization token and never with a service-role client. The guard fails closed on missing function, SQL/RPC error, unexpected output or revoked session.
- A password reauthentication can create a **different** valid session; it must not revive a revoked original request. The check is repeated after reauthentication. Ownership/history still gets a second independent check.
- The hard delete remains disabled unless `VENI_SHARED_RESERVE_DELETE_PREFLIGHT=enabled`; existing hosted Website delete-account v2 has not received these changes.

## Evidence / execution

- `node --test tests/integration/account-deletion-guard.test.mjs`: tests a valid session, unavailable/malformed checker, revoked signed token, revocation during password step-up, owner/history, forged target, password failure and denied administration.
- `reserve-integrated-cutover-rehearsal.yml`: creates the self-only function on disposable TARGET via SQL, tests genuine GoTrue session tokens through actual PostgREST, then removes precisely one disposable `auth.sessions` row and verifies that the still-signed JWT's session is rejected before delete; a fresh local login is necessary. Existing Website/Arcana and Reserve users, tenants, invitations and audits remain intact.
- All SQL targets must be loopback-only local CI stacks. No hosted Supabase, DNS, email, payments, keys, data export or real accounts involved.

## Release blockers deliberately left open

1. The helper/RPC are only a proposed contract; no reviewed database migration or deployment exists. Generate migrations through the installed Supabase CLI, review privileges/advisors, and independently prove them against the actual target schema before release.
2. The final live-session check and Auth admin delete are not one database transaction; a short revocation/ownership time-of-check/time-of-use window remains. A server-side transactional/fencing design and independently exercised recovery are required for a strict guarantee.
3. Revoking sessions does not by itself force every other product's RLS or external API to recheck revocation. Reserve and other sensitive Sphere operations need their own session-liveness policy.
4. OAuth-only/passwordless accounts need a separately designed step-up path. Account history, owner transfer, lawful retention, deletion receipts, backups and operator review are separate gates.
5. Never enable the feature flag or merge this draft until shared Website Auth architecture is ratified, Reserve history policy and account lifecycle are approved, hosted backup/rollback gates pass and Ian separately authorises deployment.

**Security interpretation:** This narrows a known denial gap but is not yet a production-safe account deletion system.
