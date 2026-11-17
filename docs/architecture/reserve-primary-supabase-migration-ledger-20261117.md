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
