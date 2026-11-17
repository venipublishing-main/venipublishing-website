# Veni Account — Hosted Supabase read-only preflight

**Observation date:** 2026-11-17 (South Africa time)  
**Status:** Evidence only · **NO GO for hosted cutover** · no hosted changes performed

This report refreshes the proposed Reserve staging → Website Account integration. It is deliberately limited to non-mutating Supabase project listings, catalogue inspection, aggregate SQL, ephemeral collision comparison, official Supabase guidance and existing GitHub source. No account was signed in as a user, no password/secret values were collected, no database was dumped, no project was paused, and no hosted configuration or migration was changed.

## 1. Projects, hosting and operational scope

| Property | Website destination | Reserve staging source |
| --- | --- | --- |
| Project | `droslqfcazwkwvqlbtsq` | `opjgaepryqwmsohtajja` |
| Organisation / plan | Veni Publishing / **Free** | Veni Flow / **Free** |
| Status at inspection | `ACTIVE_HEALTHY` | `ACTIVE_HEALTHY` |
| Region | `eu-central-1` (Germany) | `eu-west-1` (Ireland) |
| PostgreSQL engine/build | 17 / `17.6.1.166` | 17 / `17.11.0.003` |
| Hosted application schema | Website Account + Arcana | Reserve M1 tenant/access/audit foundation |
| Supabase Storage buckets / object records | **0 / 0** | **0 / 0** |
| `vault.secrets` records | **0** | **0** |
| Deployed Edge Functions | `delete-account` (JWT verification enabled) | None |

The separate `sports-core-dev` project (`tdiiuqbagclwknlmdlfb`) remains **INACTIVE**. Reserve's version-controlled README explicitly identifies `vf-reserve-stg` as *staging* and states that **Reserve production has not been provisioned**. A later production environment must be inventoried separately; do not relabel staging test identities as paying customers.

The cross-region and PostgreSQL patch difference is real: local PostgreSQL 17 compatibility alone cannot certify a hosted region transfer, site configuration or target-service upgrade. Both sides currently have the same five installed extensions (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`), but extension ownership/configuration and platform-managed grants still require independent recovery verification.

## 2. Authentication and identity — exact read-only counts

| Metric | Website | Reserve |
| --- | ---: | ---: |
| `auth.users` | **1** | **5** |
| `auth.identities` | 1 | 5 |
| Identity provider distribution | 1 email | 5 email |
| Accounts with a non-empty password-hash field | 1 | 5 |
| Email-confirmed accounts | 1 | 5 |
| MFA factors | 0 | 0 |
| `auth.sessions` records | 2 | 0 |
| `auth.refresh_tokens` records | 3 | 0 |

These are **exact `COUNT(*)` query results**; the lightweight `list_tables.rows` estimate incorrectly reported zero Website Auth users, so only the SQL counts should be used for migration totals. Session and refresh-token records are **not proof of currently valid active sessions**.

An additional comparison on 2026-11-17 computed one-use salted fingerprints of IDs, normalised emails and `(provider, provider_id)` keys **in the database**, compared them only in ephemeral tool memory, and printed only aggregate collision counts:

- User UUID collisions: **0**
- Normalised email collisions: **0**
- Provider-identity key collisions: **0**

No plaintext emails, user UUIDs, password hashes or fingerprint values were printed, committed or persisted. Re-run collision and provider/configuration checks immediately before any future cutover; this is a point-in-time finding, not a perpetual guarantee. Existing Website sessions must be handled explicitly if the destination signing authority is rotated or Auth configuration changes.

The **configured** (including dormant) SMTP, magic-link, OAuth/SSO, callback, redirect, hook, JWT signing-key and Auth service-version settings are **not established** by database row counts or the current Supabase connector; mark as **unknown**, not as absent.

## 3. Exact hosted application-table inventory

Website (`public`, **7** application tables; exact records):

| Table | Records |
| --- | ---: |
| `profiles` | 1 |
| `products` | 2 |
| `entitlements` | 0 |
| `arcana_cards` | 6 |
| `arcana_readings` | 0 |
| `arcana_reading_cards` | 0 |
| `arcana_journal_entries` | 0 |

Reserve (`public` + `private`, **10** application tables; exact records):

| Table | Records |
| --- | ---: |
| `public.tenants` | 2 |
| `public.users` | 5 |
| `public.memberships` | 4 |
| `public.permissions` | 53 |
| `public.roles` | 4 |
| `public.role_permissions` | 132 |
| `public.membership_roles` | 4 |
| `public.audit_events` | 10 |
| `private.invitations` | 0 |
| `private.invitation_roles` | 0 |

**No booking, reservation, payment or tenant-business-settings table is deployed** in the currently connected Reserve staging source. The existing disposable M1 test fixtures cover the current ten-table domain, but do **not** prove future booking features or a deployed end-to-end booking flow. Preserve the existing Website user/profile, two product records and six Arcana cards; an empty `entitlements` table does not justify overwriting the other Website data.

### Migration/feature drift

- Website hosted migration ledger: `20260903071048_revoke_handle_new_user_rpc_access`, `20260903072229_arcana_stage3_pilot_foundation`.
- Reserve hosted migration ledger: `20261030154642_m1_1a_tenant_user_membership_persistence`, `20261030174937_m1_1b_role_permission_invitation_audit_foundation`, `20261031031256_m1_2_rls_cross_tenant_security`.
- The **Reserve main branch additionally contains** `supabase/migrations/20261103160923_tenant_business_settings.sql`, **not present in its hosted migration ledger**. That source file includes further settings tables, functions and a specialised role. Do not include its objects in the as-deployed manifest or claim it has been applied.
- The Website repository also contains `20260903_001_veni_account_foundation.sql` without that exact version in the hosted ledger. Reconcile applied schema/history rather than assuming every file maps one-to-one to a recorded hosted migration.
- Reserve draft PR #23 is explicitly local-only OAuth/PKCE integration; do not confuse it with deployed production OAuth configuration.

## 4. Security and dependent services

- All **17** currently deployed application tables across the two projects have RLS enabled; this does not alone prove correct permissions.
- Current catalogue: Website **15** public/private RLS policies, **1** app `SECURITY DEFINER` function and **6** custom app/Auth triggers; Reserve **7** app RLS policies, **7** app `SECURITY DEFINER` functions and **22** custom app/Auth triggers. Definitions, ownership, grants and behavior must be inventoried and reconciled before import.
- Security advisor: both projects flag leaked-password protection disabled. Supabase's official password-security guide states that feature is **Pro and above**; do not promise to enable it while remaining on Free or change plans without owner approval.
- Reserve advisor additionally flags three RLS-enabled tables with no policies (`private.invitations`, `private.invitation_roles`, `public.permissions`). This may be intentionally deny-by-default; evaluate effective access rather than automatically adding broad policies.
- Health advisors reported no findings for either project at inspection.
- **Deployed deletion endpoint — hard no-go discovered in this audit:** The currently ACTIVE Website `delete-account` Edge Function (version 2, JWT verification enabled) authenticates the requester with `auth.getUser()` and then calls `admin.auth.admin.deleteUser(user.id, false)` **without a Reserve tenant-ownership/history preflight**. `false` requests hard deletion, not a soft-delete. The service-role call is server-side, but after Reserve integration its authorization check is incomplete. **Do not redirect Reserve users to this endpoint until a reviewed deletion preflight has been implemented and tested** for tenant owners, staff, historic records, protected audit, orphan prevention, retries and unexpected failures.
- **Current FK behavior matters:** Reserve's `public.users` → `auth.users` foreign key is `ON DELETE RESTRICT` and may reject the hard delete while the projection row exists; that is a database safety net, **not** a usable account-deletion workflow or proof against alternate deletion paths. Website currently has `ON DELETE CASCADE` from Auth to `profiles`, `entitlements`, `arcana_readings` and `arcana_journal_entries`, so deletion/retention policies need careful product-by-product reconciliation. No DELETE was executed for this audit.
- An empty Supabase Storage catalogue and empty `vault.secrets` table **does not** certify that no files, app environment secrets, SMTP credentials, external services or object links exist elsewhere. Scope the application/configuration inventory before relying on that simplification.

## 5. Free-plan recovery — **blocking gate**

The official [Supabase Database Backups guide](https://supabase.com/docs/guides/platform/backups) states that **automatic daily backups are for Pro, Team and Enterprise** and recommends regular CLI `db dump` exports plus off-site copies for Free projects. Its [Restore to a new project guide](https://supabase.com/docs/guides/platform/clone-project) requires a paid plan/physical backups and a newly billed project; **it is not a $0 staging or rollback mechanism for this situation**. The database backups also do **not** contain external Storage object bytes.

For this pair of Free projects, do **not** begin cutover unless an operator has:

1. With separate authorisation for handling the hosted personal data, produced time-consistent, encrypted, access-controlled **logical exports** of both real databases using an explicitly pinned and locally verified CLI/pg_dump method; account for `auth`, `public`, `private`, app grants/functions, schema and supported role reconstruction.
2. Protected the exports and integrity manifests **outside GitHub, public CI and chat**, with restricted access, redacted logs, retention/deletion procedures and tested hashes.
3. Independently restored **both** backups into a permitted, isolated environment and shown exact Website/Reserve row reconciliation, working controlled sign-ins, tenant RLS, Website/Arcana data preservation, audit invariants and application behavior. This is a future authorised data-processing task, **not done** in this read-only audit.
4. Documented all unexportable platform settings, Vault/root keys, Auth JWT keys, external secrets, provider callbacks, project URLs, API keys, SMTP, triggers, Edge Function config, active external object stores, workflows and their safe recreation.
5. Measured backup duration, restore duration, permitted data-loss window and post-freeze writer delta; obtained owner's explicit rollback acceptance. If a completely isolated restore cannot be completed at $0 with safe data handling, **stop and request a decision** rather than opening a paid Supabase branch/project or attempting live changes.

**Rollback constraint:** Restore the Website snapshot only while destination writes are frozen; once new legitimate writes exist, a blind rollback can lose transactions. Keep Reserve intact through a separate post-cutover acceptance period and do not permit both projects to become independent writable masters.

## 6. Gate register / next evidence

| Gate | 2026-11-17 result | Next required proof |
| --- | --- | --- |
| Project/plan/region/Pg versions | **Observed** | Repeat before window; decide target patch compatibility and region effects |
| Hosted Auth counts/providers/collisions | **Observed, no collisions** | Management-level Auth/SMTP/OAuth/hook/key settings and fresh identity collision check |
| Current M1 table inventory and row counts | **Observed** | Resolve repo/hosted migration drift; capture future M2/booking work if deployed |
| Storage metadata and Vault row counts | **Both zero** | External storage and configuration/secret dependency review |
| Platform privileges and RLS/advisories | **Partially observed** | Privileged ACL/ownership and functional deny/allow acceptance |
| Deployed Website account deletion vs Reserve tenancy | **Unsafe to reuse unchanged; hard no-go** | Verified tenant-owner/history preflight before `admin.deleteUser`; controlled denial and non-loss tests |
| Independent synthetic DB/Auth recovery | **Passed in [draft PR #7](https://github.com/venipublishing-main/venipublishing-website/pull/7)** | Hosted backup + independent real restore under approved data handling |
| Free-plan hosted backup and rollback | **NOT performed — blocking** | Two encrypted exports, isolation, restore, reconciliation, measured recovery |
| Booking history and booking-flow migration | **Not applicable to current M1; future gate** | Test when real booking tables/flows are deployed |
| Hosted merge / deployment / authorisation | **NOT performed / NO GO** | Explicit Ian approval only after all gates pass |

**Boundary:** This report must never be interpreted as approval to perform hosted writes, enable public users/payments, deploy OAuth, merge drafts, pause Reserve or delete anything. Preserve the Website project, Reserve staging project, paused Performance project, DNS and existing Veni Kids route.

**Sources:** Supabase project and SQL read-only inspection 2026-11-17; current GitHub Reserve/Website main branches; existing Website [draft cutover runbook](reserve-website-hosted-cutover-runbook-DRAFT-20261116.md); [Supabase backup docs](https://supabase.com/docs/guides/platform/backups); [Supabase restore-to-new docs](https://supabase.com/docs/guides/platform/clone-project); [Supabase password-security docs](https://supabase.com/docs/guides/auth/password-security).
