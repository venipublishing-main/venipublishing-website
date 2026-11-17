# Veni Account → Veni Reserve integration contract v0.1

**Status:** DRAFT technical handover, 17 November 2026. **Not ratified, not deployed, not a release approval.**
**Ownership:** Veni Website owns the shared account/identity boundary; Veni Reserve owns business tenants, memberships, roles, bookings, and its independent product journeys.

## What is established

- Veni Publishing is the umbrella and discovery entry. Reserve remains a standalone Veni Flow product with its own landing, sign-in/onboarding, workspace and public booking routes. A visitor may go directly to Reserve; the Playground is optional and never a condition of sign-up (Reserve Master Ledger VR-1486–1490).
- Website's existing Auth and Reserve's initial staging Auth are **different Supabase projects**. Same email, browser cookie, profile name, or copied JWT does not prove a shared subject or an active Reserve membership.
- Current Website PRs #2–#11 and Reserve PRs #16/#20/#22/#23/#24 are **draft/unmerged** local proofs. Website PR #2 explores a single-Auth, namespaced Postgres deployment; Website PR #3 + Reserve PR #23/#24 explore an OAuth 2.1 authorization-code/S256-PKCE link to Reserve SSR. These are **architecture candidates**, not simultaneously active services. Local tests are useful evidence, not an approved production contract.
- Reserve local M1 owner/bootstrap and M2.1 settings are real disposable Auth/database operations; Theme revisions are private-local only. Neither gives hosted users access or publishes live booking.

## Boundary and responsibility contract

| Boundary | Website/parent | Reserve/product | Non-negotiable invariant |
| --- | --- | --- | --- |
| Primary identity | Authenticate Veni Account principal; verify email where appropriate | Accept only a verified, approved subject mapping | No automatic account linking from matching email |
| Entry/navigation | Link conspicuously to independent Reserve landing | Deep-link independent registration, login, `/app`, and future booking; subtle footer attribution | No mandatory tour, cross-sphere redirect, or Playground data import |
| Session | Establish identity under selected approved transport | Verify live session on every sensitive request; use its own secure SSR session where appropriate | Do not treat static access-token signature or cookies as live authorization |
| Entitlement | Potential account-level product access/discovery | Own active tenant Membership, capabilities, business status, Owner continuity | `login != tenant membership`; scopes never grant a business role |
| Data | Parent account profile/consent, privacy controls | Tenant records, bookings, staff, Theme, audit, export | Tenant RLS enforced in database, with server-context authorization |
| Closure | Auth/account request, MFA and privacy review | Examine owner replacement, all tenant/history/holds and product consequences | No generic cascade deletion of historical Reserve accounts |

### Reference interface (logical, transport-neutral; not an implemented endpoint)

1. `IdentityPrincipal`: server-resolved `{ identity_provider, issuer, stable_subject, account_id?, assurance, verified_at, live_session_id }`. `account_id` is the same `auth.users.id` only **if** shared-backend migration is chosen, reviewed and completed; otherwise subject→Reserve user mapping must be explicitly controlled. Never accept these fields directly from request JSON or user-editable metadata.
2. `ReserveActorContext`: derived server-side from `IdentityPrincipal` plus **live** Reserve membership query: `{ reserve_user_id, tenant_id, membership_id, role, permitted_actions, tenant_state }`. Missing, suspended, revoked, ambiguous, stale, or foreign-tenant state denies access.
3. `ProvisioningRequest`: explicit signed-in user intent to create a business, idempotency key, and server-validated profile. Reserve creates a `SETUP` Tenant plus active Owner Membership and audit atomically. Never grant a Tenant or Owner role merely for possessing an email scope.
4. `ReturnIntent`: allowlisted local product path only (e.g. Reserve setup or workspace). No arbitrary `next` redirect, token in query string, or accidental landing on a sibling Veni product.
5. `AccountLifecycleReview`: privacy/retention status, all Reserve/Arcana/other Sphere references, ownership transfer, immutable audit/evidence, backup/recovery review, explicit account closure outcome. Self-service deletion remains blocked for linked accounts until validated.

## Identity transport choice — an explicit decision gate

**Candidate A — shared Supabase Auth and namespaced data** (Website draft PR #2 and stacked #4–#11): one principal UUID, Reserve-owned `reserve.*`/`reserve_internal.*`, bounded adapters, tenant RLS, independent product UI. Choose only after audited migrations, collision mapping, schema version compatibility, Auth/Storage/keys/provider recovery and rollback, owner continuity, and exact session invalidation are demonstrated. The tested cloned-database full GoTrue restart has **not** passed; production restore is therefore not established. A central `auth.users` deletion can be blocked by Reserve FKs and must not be bypassed with cascade.

**Candidate B — Veni Account OAuth issuer → standalone Reserve SSR client** (Website draft PR #3, Reserve #23/#24): authorization-code plus S256 PKCE, bound state, approved confidential client, strict callback and issuer/audience binding, one-use codes, server-only exchange and tokens, session lifecycle and revocation. The local proof currently uses OAuth `email` scope; this is **not proof of OpenID Connect/OIDC ID tokens or a complete OIDC/JWKS federation**. Reconcile stable identity and account linking and validate provider configuration and an actual human browser consent flow before considering hosted activation. A downstream Reserve session is not automatically invalidated by upstream logout; define and test it.

No choice is ratified. Whichever transport wins must satisfy the same `ReserveActorContext`, zero silent entitlement and product isolation. No hybrid cutover or dual-session assumption without a new reviewed design.

## Security, consent and data obligations

1. Exact issuer, audience/client, algorithm, expiry/not-before, nonce/state, redirect and code-verifier checks at their correct protocol layers; verify current provider session and revocation. Test wrong-project tokens, stale signed tokens, replay, cancelled consent, key rotation, multiple tabs and logout.
2. Confidential credentials, service-role and token exchange stay server-only. Cookies use appropriate `Secure`, `HttpOnly`, host scope and SameSite settings; CSRF protections protect mutations. No arbitrary redirect, token logging, cross-product cookie sharing or authorization from `user_metadata`.
3. Database RLS, membership/role checks and audit must be proven against genuine local Auth/Postgres with distinct tenants, including Owner transfer, invitation history and stale-session denial. A unit mock is not RLS evidence.
4. POPIA-aware record-level retention, data access/export and account closure require a decision matrix; immutable audit records and legitimate holds must not be erased just to satisfy a test-account cleanup request. Website PR #10 only offers tightly scoped fresh, unassigned CI synthetic deletion; PR #11 historical review is non-mutating and its mocked AAL2/dual approval is **not** a human admin deletion interface.
5. Shared hosting must preserve tenant export, independent product extraction/rollback, backfill/reconciliation, and no unintended cross-Sphere data or permissions. Performance/Sports is a **later, separately owned integration**, not a reason to widen Reserve grants today.

## Reserve acceptance checklist (Website is the upstream contract owner)

| ID | Required outcome | Evidence/status | Owner |
| --- | --- | --- | --- |
| WA-R01 | Product boundaries, direct routes, optional Playground and no unrelated promotions accepted | **READY TO IMPLEMENT** under VR-1486–1489 | Reserve UI |
| WA-R02 | Model `IdentityPrincipal` → separately queried `ReserveActorContext` with deny-by-default tenant checks | **READY IN LOCAL CODE**, requires review in chosen architecture | Reserve Security + Website |
| WA-R03 | Prove business setup idempotency, active Owner and saved M2.1 local settings with tenant isolation | **LOCAL PROOF AVAILABLE**, Reserve PR #20; owner browser review open | Reserve |
| WA-R04 | Verify one selected identity transport, issuer/linking/PKCE/consent/session/return tests | **BLOCKED BY ARCHITECTURE DECISION**; local proof PR #24 only | Joint |
| WA-R05 | Confirm owner continuity, history/holds and deletion/retention procedures | **DESIGN OPEN**; Website PRs #9–#11 draft | Joint Privacy/Security |
| WA-R06 | Verify schema/Auth backup-extract-restore including exact GoTrue restart and storage bytes if shared | **BLOCKED**; Website #4–#11 synthetic recovery incomplete | Website infra + Reserve |
| WA-R07 | Owner browser walkthrough and independent security review with signed-off evidence | **OPEN**; local CI is not manual browser acceptance | Joint |
| WA-R08 | Explicit approved hosted staging activation/rollback/monitoring then separate production release | **NOT AUTHORIZED** | Owner |

## Release discipline and evidence

- **GREEN:** Reserve may resume local synthetic M2 domain/settings, scheduling, M4/M5 models, accessible independent UI, M7 private Theme previews and test coverage; its existing M0–M14 gates still apply.
- **AMBER:** Implement adapters/tests behind a permanently-off hosted flag pending architecture, account-linking, legal/security and browser acceptance.
- **RED:** No production or staging Auth/SQL mutation, customer enrollment, business publishing, payment acceptance, DNS or Cloudflare changes, PR merge, real-account deletion, owner bypass, provider/OAuth activation or shared signing-key rotation on the strength of this handover.

**Source authority:** Reserve Master Product Ledger VR-1486–1490 and Issue #13 addendum; Reserve Architecture Reconciliation Register; Veni Platform Unified Supabase Merger Blueprint v0.1. **Implementation evidence:** [Reserve PR #20](https://github.com/venipublishing-main/veni-reserve/pull/20), [Reserve PR #22](https://github.com/venipublishing-main/veni-reserve/pull/22), [Reserve PR #24](https://github.com/venipublishing-main/veni-reserve/pull/24), [Website PR #2](https://github.com/venipublishing-main/venipublishing-website/pull/2), [Website PR #3](https://github.com/venipublishing-main/venipublishing-website/pull/3), [Website PR #11](https://github.com/venipublishing-main/venipublishing-website/pull/11). All draft status is as checked on 17 November 2026.
