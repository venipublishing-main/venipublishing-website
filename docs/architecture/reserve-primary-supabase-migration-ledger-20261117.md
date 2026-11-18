# Reserve → Veni Publishing primary Supabase: hosted migration ledger

Verified 17 November 2026. This ledger records actual hosted DDL, not a proposed
simulation or a declaration that the Reserve web application has been released.

## Projects and scope

- **Destination / canonical Auth:** `droslqfcazwkwvqlbtsq`, Veni Publishing Website.
- **Original Reserve staging retained:** `opjgaepryqwmsohtajja`.
- **Sports remains inactive.** No Sports project was changed.
- Destination migration is **additive**: `reserve` tenant tables,
  `reserve_internal` private tables, isolated executor roles, and
  `public.reserve_*` entry points. It does not rename or replace the parent
  `public.profiles`, Arcana tables, or `auth.users`.

## Applied destination migration history

All nine calls to the primary Supabase migration tool returned `success: true`.
Actual versions from the hosted migration history (matching filenames):

| Version | Name |
| --- | --- |
| 20261117160650 | reserve_shared_tenant_core |
| 20261117160716 | reserve_shared_roles_audit |
| 20261117160729 | reserve_shared_rls |
| 20261117160741 | reserve_shared_business_settings |
| 20261117160759 | reserve_shared_bootstrap |
| 20261117160810 | reserve_shared_private_theme |
| 20261117160831 | reserve_shared_locations |
| 20261117160843 | reserve_shared_services |
| 20261117160855 | reserve_shared_staff_eligibility |

The migration SQL was generated from **Git-blob-pinned** Reserve source
migrations and namespace converters, then reproduced byte-for-byte (except for
the first provenance comment) in Website migrations. The exact deployable SQL
files passed disposable genuine GoTrue/PostgREST CI, including Theme,
Location, Service, Staff/eligibility, session revocation, tenant isolation,
revision conflicts and Arcana coexistence. Website CI run
`44123242791` passed against the server-version-aligned migration filenames.

## Hosted postflight (read-only)

| Assertion | Before | After |
| --- | ---: | ---: |
| Website `auth.users` | 1 | 1 |
| Website `public.profiles` | 1 | 1 |
| `public.arcana_cards` | 6 | 6 |
| Reserve tenant tables | 0 | 8 |
| Reserve private tables | 0 | 18 |
| Reserve private tables with RLS | 0 | 18 |
| Namespaced `public.reserve_*` RPCs | 0 | 18 |
| Limited Reserve executor roles | 0 | 6 |

Hosted privilege queries also returned **zero** violations for:

- direct `anon`/`authenticated` reads/writes to private Reserve tables;
- Reserve public/private tables without RLS;
- anonymous execution of Reserve public RPCs; and
- missing authenticated execution rights on the expected Reserve RPCs.

The Supabase linter flagged four deliberately deny-all RLS relations without
policies (permissions, invitations, invitation roles, unpublished assignments).
Its existing leaked-password-protection warning was present before migration.

## Source data disposition

Reserve staging has **five** Auth accounts, **all** `@example.invalid`, and
two synthetic tenants with four memberships. They were **not** inserted into
the real Website Auth project, which still has its one existing account.
This was an infrastructure migration, not migration of staging fixtures.
The source remains active and unchanged so its synthetic audit history can
still be inspected if required. There were no identified live customer
accounts or patient booking tables to import from the source hosted project.

## Application cutover

The staging configuration and protected workspace use the primary project's
public key, namespaced RPCs and central Veni Account. Local integration
exercised sign-in through the real Worker callback, idempotent tenant creation,
settings, all private catalogue reads, two-tenant separation and sign-out.

On 17 November, Website PR #27 merged the nine matching migration files and
the registered staging client's consent page. At 18:38 UTC, Cloudflare sent
100% of staging traffic to Worker version `c7405d4d-f648-47f6-8fe4-a862f1e6cfe6`
(deployment `3d2f7d0e-7620-4cb6-bf35-7b1b286fffee`). Its deployed bindings
select the primary Supabase URL and shared account mode. The registered
client ID, client secret and cookie key are Worker secret bindings.

The primary Auth Site URL is `https://venipublishing.co.za`. Its redirect
allowlist retains all six GitHub Pages preview entries and includes the live
Website account and password reset URLs. A staging login returned an S256
PKCE request to primary Auth, which redirected to the live Website consent
page. That page returned HTTP 200. An unsigned workspace API request returned
401. A completed user callback and protected workspace check are separate
retirement gates. See the [transfer record](reserve-to-primary-supabase-transfer-20261117.md).

For a Worker rollback, confirm the source project is active and healthy first,
then restore version `28c632e7-84fe-463a-ba4a-7a558596425d` on `vf-reserve-stg`
and verify its readiness. Preserve the primary database and new tenant records
during traffic rollback. The former primary Auth Site URL was
`https://venipublishing-main.github.io/venipublishing-website-preview/`.

At 18:55 UTC on 17 November, deployment `da124d71-f570-4f1a-9adf-5d4a85e1a0a3`
sent 100% of staging traffic to version `33673f94-f593-49c2-9aa9-b4f8080f1a94`
from [Reserve PR #34](https://github.com/venipublishing-main/veni-reserve/pull/34).
It keeps logout retryable during an Auth outage and clears the tenant setup
receipt after revocation. The prior shared-account version
`c7405d4d-f648-47f6-8fe4-a862f1e6cfe6` is the rollback target for this fix.

[Shared integration CI](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44151574979)
passed with that exact Worker commit, including real callback, tenant writes,
cross-tenant denial, deletion retention and logout on disposable accounts.
Hosted health, readiness, anonymous workspace denial, primary OAuth routing,
Website consent availability and logout cookie clearing passed after rollout.
At that check, primary Auth had zero completed Reserve consent grants. The
original project was active pending a completed hosted sign-in.

## Hosted browser verification on 18 November

The existing Website account authorized the registered Reserve staging client
and reached the protected Business setup page. It displayed “No authorized
businesses yet.” The browser identity matched the UUID in the primary Auth
session and Website profile. Primary still had one identity, zero Reserve
tenants, six Arcana cards and all nine Reserve migration versions.

The authenticated logout button displayed a retry error. Worker traces showed a
same-origin request and HTTP 503. Hosted GoTrue v2.198.0 recorded HTTP 403 with
error code `no_authorization` for `POST /auth/v1/logout?scope=local` because
that endpoint rejects OAuth client access tokens. The provider session remained
afterward. The 17 November cookie-clearing probe used an unsigned request and
did not test provider revocation. The local CLI stack used GoTrue v2.197.0.

Retirement remains blocked on successful authenticated logout. Repeat the
browser test against the hosted Auth version after the fix. The old project
was still active with five synthetic identities, two tenants, four memberships,
zero pending invitations and zero storage objects.

## 18 November 2026 coordinated disconnection release

At 06:08 UTC, [Website PR #32](https://github.com/venipublishing-main/venipublishing-website/pull/32) merged as `c290cad4a136ca2355f0987012db8d5ae18bec0f`. [GitHub Pages deployed that commit](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44249137361). Before Reserve merged, a fresh signed-out browser loaded the canonical account settings page and client registration script with HTTP 200. The Connected applications section honored the sign-in requirement. The browser imported the reviewed module with HTTP 200 and `text/javascript; charset=utf-8`. Its contents matched the release source. The browser reported zero console errors, page errors or failed requests.

[Reserve PR #35](https://github.com/venipublishing-main/veni-reserve/pull/35) merged as `725497add49b765d6d2d7d61d5f7e5eb72aa9a04`. At 06:17 UTC, Cloudflare deployment `0dbfe91b-7dcc-4136-ba03-6c36c5c7a066` sent **100%** of `vf-reserve-stg` traffic to version `dc92dc55-0641-4e88-bb1b-e2cb70a1252c`. The served workspace bundle matched the release build byte for byte and included both **Sign out of this browser** and the all-device disconnection link to Website settings. The Reserve home page loaded without browser errors. Health and readiness returned 200, anonymous workspace API access returned 401, and the protected page redirected to login. The deployed binding names and types matched the prior version.

All five reviewed PR checks passed. The [cross-repository disconnection test](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44235736781) ran the Website changes with Reserve commit `3218fbaa0a89097be9205225ef57423ac5d497fa` and isolated GoTrue v2.198.0. It reproduced the OAuth logout 403, exercised cancellation and retry, and confirmed that grant revocation denied two existing Reserve sessions and an issued JWT. The Website session and control application retained access, and Reserve required fresh consent. Update the Reserve commit pin in `.github/workflows/reserve-disconnection.yml` as the integration develops and rerun the test against the intended pair. [Reserve merge-commit CI](https://github.com/venipublishing-main/veni-reserve/actions/runs/44249368167) also passed before deployment.

Read-only checks found all nine Reserve migrations applied and both Supabase projects active and healthy. Before and after the Worker rollout, primary had zero Reserve tenants and zero Reserve users. The single Website identity, four Auth sessions and one active Reserve staging grant were present in both checks. This release changed application code only.

**Rollback.** The preceding Website release is `dc903deebe025f9c953b5b5413b3595a72313663`. Cloudflare still lists the previous staging Worker version `33673f94-f593-49c2-9aa9-b4f8080f1a94`. For a coordinated rollback, restore that Worker before reverting the Website release so the staging link continues to have a destination.

**Acceptance.** Infrastructure and database migration are complete. Canonical account integration is deployed, and hosted sign-in was accepted earlier on 18 November. Hosted all-device disconnection awaits Ian's explicit approval and a successful two-browser test with his existing account. Legacy project retirement remains a separate decision.

## Hosted disconnection acceptance

Ian explicitly approved the hosted test with his existing Veni Account. At the start of the test, primary had one Auth identity, one active Reserve staging grant, zero unrelated active OAuth grants, zero Reserve tenants and zero Reserve users. Website settings showed Reserve staging as connected. The first browser profile reached the protected workspace and displayed “No authorized businesses yet.”

The independent Chrome profile also displayed “No authorized businesses yet.” The in-app confirmation opened, but its dialog handle closed before cancellation could be verified. Chrome Website settings still showed “Reserve staging is connected,” and a read-only provider check confirmed one active Reserve grant. Cancellation and subsequent revocation remain unverified at this checkpoint.

**Hosted result on 18 November: acceptance incomplete.** Immediately before the Chrome cancellation handoff, primary Auth had one active Reserve grant and three Reserve session rows. Ian reported choosing Cancel and seeing the connected status. The next protected request from the in-app profile returned `unauthenticated`. No automated confirmation acceptance was issued. Primary Auth recorded grant revocation at **07:25:06 UTC**. At 07:26 UTC the active Reserve grant and Reserve session counts were both zero. The provider record establishes when revocation occurred. It does not identify which browser dialog or choice caused it.

The protected session endpoint also denied the original Chrome profile. Both browsers' authenticated Website settings showed “Reserve staging is disconnected.” Primary still had one Auth identity, four non-OAuth session rows, zero unrelated active grants, zero Reserve tenants and zero Reserve users. No other grant existed to exercise on this account. The probes used the browsers' existing state without initiating a new login. The five-minute Reserve cookie lifetime limits what the probes establish independently about token replay.

The team did not establish the required sequence of cancellation preserving both devices followed by an observed confirmation revoking them. Fresh hosted consent was not exercised after the failure. The Reserve grant was left revoked. No database migration, Auth configuration change or project retirement was performed. Hosted disconnection acceptance remains open.
