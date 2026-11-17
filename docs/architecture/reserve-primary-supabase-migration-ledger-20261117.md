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

## Remaining release gates (not yet passed)

1. Reserve app configuration: PR `veni-reserve#32` points the **next staging
   build** at the canonical Website Supabase URL/public publishable key, and
   uses namespaced Reserve RPCs. The currently deployed Cloudflare Worker is
   still bound to the old source until redeployed.
2. Shared account browser/SSR handoff: Website proof-of-concept OAuth/PKCE
   browser tests pass on disposable services, but the deployed Reserve app
   still fail-closes protected routes as `shared_identity_not_configured`.
   Do not substitute a second login identity or accept unverified JWTs.
3. Cloudflare release + hosted smoke: deploy the reviewed build with the
   authorised Cloudflare account, verify `/health`, `/ready`, genuine Veni
   Auth sign-in, tenant bootstrap/RPC and cross-tenant denial.
4. Only then pause the original Reserve Supabase project and verify the
   active product no longer depends on its URL. Pausing is recoverable;
   deletion is **not** authorised.

**Measured completion:** database infrastructure **9/9 applied (100%)**.
Complete application/service cutover is **not yet finished**; do not use the
schema metric as a claim that the Reserve product is live or that the Sports
project has been activated.
