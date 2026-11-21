# Shared staging release decisions · 21 November 2026

Ian accepted the disposable rehearsal at Website commit `c42a9882241545a6feb99083449b94ead4bc5ee4`. The review branch adds packaging only. Recovery housekeeping was verified complete on 21 November. The dated rehearsal report retains its original observations. [Release and rollback report](../../docs/architecture/shared-staging-readiness-20261120.md) · [Accepted package manifest](manifest.json)

## Versions

| Surface | Verified baseline | Proposed candidate |
|---|---|---|
| Website | GitHub Pages reports a successful build from `aac1382f41dfb1e7bb8bf11d5ee1f74a6700d274` on main. A merge to main can publish the Website. | Application `065a31be962533576a52016dc9ac8bee6535e375`. The consent allowlist gains the new Performance UUID only during stage 2. |
| Account deletion | Latest verified primary Edge Function `delete-account` v3, JWT verification enabled. | Same authenticated user verification plus a live direct-session RPC check before the administrator call. |
| Reserve staging | Cloudflare deployment `0dbfe91b-7dcc-4136-ba03-6c36c5c7a066`, Worker version `dc92dc55-0641-4e88-bb1b-e2cb70a1252c`, 100% of staging traffic at review. | `vf-reserve-stg`, corrected PR #37 at `756e25a8919eae41964ece4e836388fa0dbd3a8a`. The Website SQL adds the 15-line atomic Reserve client classification. [Reserve PR #37](https://github.com/venipublishing-main/veni-reserve/pull/37) |
| Performance staging | Cloudflare's deployment lookup found no `vf-performance-stg` Worker. | Source `e4f42b6ab6dd94effa94125ccb4e560d846991ca`. Both Worker candidates passed build and staging dry-run. A hosted version ID is assigned at deployment. [Reviewed Performance source and operator tools](performance-source.zip) |

The manifest identifies every accepted local file. Website changes and forward SQL are visible in this PR. Reserve source is available at the pinned PR head. The Performance ZIP is the byte-identical source bundle from the accepted package. Its SHA-256 is `c8d78d153e2d8cb80d017befd838b3d99fcef4e296ebdcbc7527d3b701ff93e6`. The five hashes below cover canonical Git bytes.

## Hosted migration order

Apply only to primary `droslqfcazwkwvqlbtsq` after approval and an exact dry-run plan. Eleven historical versions, including nine Reserve versions, must already be recorded. The fixture-only bootstrap and all historical versions are excluded from the apply list.

| Order | Forward migration | SHA-256 | Dependency and effect |
|---:|---|---|---|
| 1 | [20261119075047_reserve_shared_onboarding.sql](../../supabase/migrations/20261119075047_reserve_shared_onboarding.sql) | `16d9974fdc25485ce0c0200e878835c0b672005d2d8e822593bfd2a23e61cba6` | Requires the eleven recorded versions and the exact existing Reserve client. Installs onboarding and the live Reserve session guard together. |
| 2 | [20261119090000_performance_shared_foundation.sql](../../supabase/migrations/20261119090000_performance_shared_foundation.sql) | `3d7c8f95a68a64f322f53acee786daf173c701942a0f1edd434b6fda2f6b8669` | Requires the shared Account and product baseline. Creates the Performance domain and entitlement checks. |
| 3 | [20261119091000_performance_role.sql](../../supabase/migrations/20261119091000_performance_role.sql) | `b029981b7cac8cbf9771afafb589497a6648d8e8a059ead80d9566f99756fd63` | Requires the Performance foundation. Installs the restricted role and routing function. Hosted Auth activation is a separate decision. |
| 4 | [20261120024423_account_reserve_publish_decisions.sql](../../supabase/migrations/20261120024423_account_reserve_publish_decisions.sql) | `ab986dbe8c311c6ca194010684e00899a1b5863990a7cefbb2570b97c241c980` | Requires Reserve onboarding and its executor. Replaces the empty adapter with the Account decision for the exact business and organization. |
| 5 | [20261120025136_account_direct_session_boundaries.sql](../../supabase/migrations/20261120025136_account_direct_session_boundaries.sql) | `374be41ba46261443c0358a5cc2b33eecbb6f902054399a2a2987f7e83026a6b` | Requires the Account, Arcana and Auth tables. Adds the direct-session RPC and private-row policies used by the proposed Edge handler. |

## Decision 1 — Shared Account migrations and Reserve draft staging

**Before approval.** Compare the primary ledger, the Reserve client's UUID, confidential method and sole callback, the empty hook baseline, Free capacity and rollback versions. Confirm direct Website refresh, private Arcana reads and Reserve consent/workspace for an approved participant. Check primary readiness, HTTP 200 on staging health and readiness, and HTTP 401 for an anonymous workspace. Agree on canary scope before any hosted writes.

**Changes.** Apply the five forward migrations in order with Performance registration, hook and grants inactive. Verify acceptance after SQL, then deploy the reviewed JWT-verified Edge handler and Reserve staging Worker with Version URLs disabled. Verify direct-session and delegated-session decisions through the read-only RPC. Use mock evidence for the destructive deletion operation. Recheck existing sessions, draft availability and default-denied publication. Any hosted draft-write check needs an approved synthetic workspace. The Account adapter requires an operator-verified business/organization binding, a current subscription or free-pilot decision, and owner authority.

**Stop and rollback.** Stop on ledger drift, unexpected client, failed migration, broken sibling access, a lost draft or unexpected authorization. Record the last committed migration, keep publication closed and retain data. Revert the Reserve Worker to its recorded healthy version if compatible with the applied schema, then repeat the checks. Keep direct-session enforcement on account deletion or temporarily contain that endpoint while fixing forward. Reverting to v3 alone would remove that control.

## Decision 2 — Performance OAuth activation and staging

**Before approval.** Require stage 1 acceptance, the reviewed routing function and role grants, an empty Performance registry, and the verified prior Auth configuration. Confirm the Reserve and Website refresh paths and Arcana privacy before touching issuance. Identify the pilot participants, recovery operator and revocation path. Recheck Free capacity.

**Changes.** Run `deployment/classify-reserve.sql`. Activate `pg-functions://postgres/veni_account_routing/access_token` only with separate Auth approval. Immediately canary Website, Arcana and Reserve. Then register a distinct confidential Performance client using `client_secret_basic` and only `https://vf-performance-stg.veni-reserve.workers.dev/auth/veni/callback`. Classify that UUID with `deployment/classify-performance.sql`, add its reviewed registration to Website consent/settings, bind the Worker configuration privately and release `vf-performance-stg` with Version URLs disabled. Admit only separately approved canaries with explicit entitlement and organization membership. Verify issuance and refresh as `performance_api`, isolation for the same person across products and organizations, two-session disconnection and fresh consent.

**Stop and rollback.** Stop new Performance sign-ins for any routing, issuance, sibling refresh, isolation or consent failure. Remove only the Performance UUID from its domain and routing registries in one transaction. Verify outstanding tokens lose protected access. From each participant's direct Website session revoke the exact Performance grant, retire the client and verify issuance and refresh fail. If the client has already been retired, finish the same participant-scoped cleanup. Count `auth.sessions.oauth_client_id` for that UUID and unrevoked `auth.oauth_consents.client_id` for it. Require **zero sessions and zero active consents**. Retirement alone left 3 and 2 in rehearsal. Withdraw the Website registration and staging traffic after preserving the revocation path. Restore the prior hook only once shared-role fallback cannot give Performance access. Recheck Website/Reserve refresh, Arcana privacy and retained domain records. Keep the dedicated role and migration history.

## Decision 3 — Public publication, VVB pilot and customer onboarding

**NO-GO under this package.** A later proposal must identify the exact public routes and build, authorized VVB owner, verified Account organization and Reserve business, bounded grant, permitted customer data and intake process. No customer-facing publication artifact is approved here.

**Preflight for that decision.** Confirm stages 1 and 2 have their own recorded outcomes as applicable. Independently verify the VVB business binding, owner authority, start/expiry and withdrawal path. Verify the publication path consults a fresh decision and denies a second business, an expired grant and a revoked grant. Have the pilot owner accept the configured booking flow and verify the approved data-handling and Free capacity limits.

**If separately authorized.** Issue only the bounded decision for the named business, enable only the approved pilot/public route, and admit customers only under the agreed intake scope. Stop on mismatched ownership, unapproved exposure, stale entitlement, booking integrity failure or capacity drift. Disable new intake/public routes, withdraw the exact grant, verify access closes and preserve existing bookings, drafts and audit history. Expansion requires a new decision.
