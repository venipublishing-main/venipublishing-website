# DRAFT — linked Reserve accounts, retention and privacy review (17 November 2026)

**Scope:** CI-only policy design and synthetic-data tests, stacked on draft PR #10. **This is not a database migration, hosted administrator endpoint, production deletion feature, legal retention schedule or executable anonymisation operation.** No hosted data may be altered under this draft.

## Decision: deletion is not one operation

Reserve's `reserve.users` projection points to `auth.users` with `ON DELETE RESTRICT`; durable memberships, assignment roles, invitations and append-only audit events point back to the Reserve identity graph. Historical IDs remain potentially identifying if a related table or external system can reconnect them to a human. Merely changing the email, replacing a name with a UUID, banning an Auth user, or calling `deleteUser` does **not** prove anonymisation.

The application must distinguish:

| User request / state | Safe intended outcome | Not authorised by this draft |
| --- | --- | --- |
| Newly created, unassigned, trusted synthetic identity with no references | Delegate to **separate** PR #10 local-only operator, with a fresh hash and confirmation | This review module executing a deletion |
| ACTIVE Reserve Owner | Hold; propose a separately reviewed ownership transfer or tenant disposition that preserves the invariant | Removing or suspending the last active Owner automatically |
| ACTIVE non-owner member/staff | Review access suspension/revocation, active sessions and retention obligations | Treating revocation as record erasure |
| REVOKED/SUSPENDED member with past actions | Retain immutable provenance; review minimisation of personal fields, legal basis and tenant/product dependencies | Cascading member, invitation, ledger or audit removal |
| Invitation-only or cross-product references | Determine all product and tenant scopes, and data-subject control; retain/restrict pending review | Email-match-based identity merge, a unilateral purge |
| Legal/financial/dispute/security hold or incomplete inventory | Stop and preserve evidence, restrict use as applicable | Override based on an administrator checkbox |
| Public genuine user's account-deletion request | Open a verified privacy case; assess applicable erasure and lawful retention separately for each product | Label the genuine user "test" to obtain synthetic cleanup |

**POPIA basis (South Africa):** Section 14 limits retention unless a valid condition applies and requires destruction, deletion or de-identification when retention ceases to be authorised, using a method that prevents reconstruction. Section 24 provides correction/deletion request rights, and the responsible party must address the request according to the Act. The Information Regulator publishes Form 2 for correction/deletion requests. Do not invent one universal retention duration; each category (security audit, payments, contractual records, school/child-related data, customer scheduling, marketing) requires a documented purpose, lawful basis, actual retention period and information-officer/legal review.

Primary sources:

- [South African Government — POPIA Act 4 of 2013](https://www.gov.za/documents/protection-personal-information-act)
- [Department of Justice — POPIA, sections 14 and 24](https://www.justice.gov.za/legislation/acts/2013-004.pdf)
- [Information Regulator — POPIA Form 2](https://inforegulator.org.za/popia-forms/)
- [Supabase — MFA assurance levels](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel)
- [Supabase — JWT claims and session identity](https://supabase.com/docs/guides/auth/jwt-fields)

## Non-mutating policy prototype

`scripts/reserve-history-retention-gate.mjs` exposes:

1. `planReserveHistoricalDisposition(snapshot, request)` — read-only planner for a **trusted `app_metadata` fixture**, exact `@example.invalid` identity, one Reserve projection, an FK and schema inventory, reconciled membership statuses/owner role, explicit invitation-by-email count, tenant-dependency scope, cross-product counts and fully enumerated holds. Missing or inconsistent evidence fails closed. Returns a snapshot-bound SHA-256 digest, impacted tenant IDs and possible next review step. It **always** returns `destructiveExecutionAllowed: false`.
2. `reviewHistoricalPlan(plan, evidence, nowMs)` — **mock-evidence CI model only** for a review packet. Requires the exact target and hash, two distinct named humans (not the target), freshly reauthenticated AAL2 sessions, *platform* privacy-review scope (not tenant admin), all relevant tenants/products, a case-numbered retention decision, no asserted hold, and a meaningful reason. The only successful result is `REVIEW_PACKET_ACCEPTED` with `executionCapability: null` and `destructiveExecutionAllowed: false`. It does not modify or authorise modifications to the account.

### Crucial warning about the review-evidence model

This code has **no real user authentication, no signing, no trusted server capture and no authorization authority**. Values like `source: 'trusted_server_session'`, `aal: 'aal2'`, and `holdCleared: true` are intentionally **simulated inputs in isolated unit tests**; a caller could fabricate them if the function were exposed. Never use this module from the browser, a public Edge route or a production service to grant privileges. A future implementation must independently call Supabase Auth, validate JWT signature/issuer/audience/session, fetch fresh AAL2 evidence, enforce reauthentication, check server-owned administrator assignment and exact product/tenant scope, validate a legally reviewed retention decision and re-run all dependencies immediately before action. Administrator session identity must be separate from Reserve tenant ownership.

### Review case and durable audit contract (future only)

Proposed immutable event sequence for a real, scoped service:

1. `CASE_OPENED`: requester, exact Auth UUID, reason, intake method, verified subject-control evidence (do **not** store secrets or copies of identity documents by default).
2. `INVENTORY_CAPTURED`: immutable summary and digest of tenant/product links, active sessions, owner roles, invitations, FK edges, external processors, holds, retention categories.
3. `REVIEWED`: named independent approver, independent privacy/legal reviewer where needed, reauthentication/session evidence reference, valid legal basis and expiry of approval. Revalidate on every privileged call.
4. `ACTION_REQUESTED`: typed and narrowly scoped action (`RESTRICT_ACCESS`, `TRANSFER_OWNERSHIP`, `REDACT_SPECIFIC_PII`, or `ERASE_ELIGIBLE_DATA`), never generic `PURGE_ACCOUNT`.
5. `ACTION_FINISHED` or `ACTION_FAILED`: transaction correlation, per-product outcomes, session revocation, downstream processors notified when appropriate; preserve original action/failure history.

Audit should record stable case ID, timestamp, actor identity, reason code, target identifier or keyed reference, plan/hash, expected and actual state, and outcome. Restrict raw PII and evidence to the fewest authorised people; maintain append-only integrity and an explicit retention policy for the audit itself. A one-way email hash is not automatically anonymous when dictionary or correlation attacks are possible.

## Hosted implementation gates (NOT met)

- [ ] Owner approves an actual hosting environment, deployment and back-up/recovery plan. Free-plan databases cannot be assumed to have managed recovery.
- [ ] Information Officer/legal reviewer signs off on per-data-category retention schedule, exceptions, rights intake and user notification.
- [ ] Exhaustive inventory across Veni Account, Reserve, Arcana, Performance and any independent instances—including external processor copies and unkeyed email references—with stable identity mapping that does not infer account equality from email.
- [ ] Actual platform support-admin identity is provisioned; server-side RBAC, fresh AAL2/re-auth, scope, two-person approval and anti-self-approval are tested. `service_role` is never shipped to a browser.
- [ ] Closing access also handles refresh tokens, outstanding sessions and the lifetime of already-issued JWT access tokens; the backend rechecks session/authorization where strict revocation is required.
- [ ] Owner transfer and membership lifecycle are implemented using existing serializable ownership invariants with a rollback test.
- [ ] De-identification design preserves ledger accuracy and legal evidence while proving whether an identifier can still be re-linked; immutable audit restrictions may require **retaining** the pseudonymous key rather than pretending it is erased.
- [ ] Complete recovery, RLS/permission, cross-product isolation, stale-approval and failure-injection tests pass on an isolated realistic clone; no constraint or immutable audit bypass.
- [ ] Separate, specific approval before any hosted Auth/membership mutation, hosted migration, branch merge or deployment.

## CI proof

```
node --test tests/integration/reserve-history-retention-gate.test.mjs
```

The synthetic cases cover: unassigned delegation, revoked historic member, active owner/member, all five holds, missing inventories, inconsistent FK/membership counts, invitation-only reference, Arcana links, changed fingerprints, plan/target mismatch, independent reviewer enforcement, MFA/session freshness, tenant/product scope, and a strictly non-executable review packet.

**Next work after review:** derive server-owned privacy case and retention inventory from the actual migrations (read-only); separately design narrowly scoped closure/de-identification operations under approved retention and recovery requirements. Do not enable hosted cleanup by copying this CI module into an Edge Function.
