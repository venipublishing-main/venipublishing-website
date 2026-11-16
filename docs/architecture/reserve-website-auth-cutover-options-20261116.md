# Reserve → Website: Auth identity, deletion, and cutover options

**2026-11-16 · Draft research and disposable-only experiments · NOT permission to deploy**

## Current decision

- The Website Supabase project is the intended **destination** and the canonical Veni Account provider.
- Reserve remains the **source** and must not be stopped, deleted, redirected, or mutated during these rehearsals.
- No hosted database, Auth account, Edge Function, or environment variable is changed by draft PRs #2, #4, or #5.
- A fresh **read-only hosted** inventory on 2026-11-16 found 5 Reserve Auth users, 1 Website Auth user, and no matching user IDs or normalised emails. An earlier tenant inventory found 2 Reserve tenants. These numbers can change; re-run all inventories before approving any cutover.

## 2026-11-16 hosted compatibility audit — read-only

| Property | Reserve source | Website destination |
| --- | --- | --- |
| Project ref | `opjgaepryqwmsohtajja` | `droslqfcazwkwvqlbtsq` |
| Health | `ACTIVE_HEALTHY` | `ACTIVE_HEALTHY` |
| Auth accounts | 5 | 1 |
| Auth identities | 5 | 1 |
| Identity providers | 5 email | 1 email |
| Accounts without password hashes | 0 | 0 |
| MFA factors | 0 | 0 |
| Source/Website overlap | 0 user UUID collisions; 0 normalised email collisions | Same cross-project comparison |
| `auth.users` and `auth.identities` column definitions | Identical fingerprint | Identical fingerprint |
| Auth user/identity constraints and indexes | Identical fingerprints | Identical fingerprints |
| Custom trigger on `auth.users` | None | `on_auth_user_created` |
| Database engine | PostgreSQL 17, patch 17.11 | PostgreSQL 17, patch 17.6 |

The cross-project collision check used one-use salted fingerprints in memory; neither users' email addresses nor the fingerprints were printed or stored in the draft repository. The fingerprints were computed from schema metadata, not password hashes. Website's profile trigger is expected and its behaviour was exercised in the disposable Auth import.

**Interpretation:** Current Auth columns, constraints, and indexes line up exceptionally well for a selective import. Distinct PostgreSQL patch versions, Auth service versions, site-specific triggers, and future schema drift still require independent preflight checks on a later cutover date. Provider/MFA counts describe current records, not all potentially configured authentication methods or dormant sessions.

## What independent local GoTrue projects actually establish

The `reserve-dual-auth-handoff.yml` GitHub Action uses **two real, separately configured, disposable local Supabase Auth and database instances**, rather than mocked JWT claims.

1. Registering the same synthetic email in each local project produces different account UUIDs. Equal email addresses are not sufficient evidence for merging accounts.
2. A Reserve-issued JWT and refresh token are rejected by the Website Auth project when the signing secrets are independent.
3. Creating a new Website account does not silently grant access with the existing Reserve password; an explicit linking/reauthentication mechanism would be needed.
4. A **selective Auth row import** is a different technique: transfer a synthetic source `auth.users` record and its `auth.identities` records into a Website database that already contains a separate user. With matching local Auth schemas, the test **did preserve** the source UUID and encrypted password while preserving the existing Website user. This is proved only on two disposable stacks, using no hosted data, identities, credentials, or passwords.
5. Even if the password hash and UUID transfer correctly, a fresh Website login is required when JWT signing secrets differ. Old sessions and refresh tokens are **not imported**.
6. A synthetic **duplicate-email collision** with different source/Website UUIDs rejected the import atomically, leaving the existing Website user intact and no orphaned source rows.
7. A synthetic **forced error after inserting Auth identities** rolled back users, identities, and the Website profile created by the Auth trigger.

Supabase's official Knowledge Base, updated 2026-11-03, confirms that an Auth schema migration can include password hashes; it also explicitly says there is no one-size-fits-all Auth-only script. JWT signing-secret differences invalidate old tokens. See [Migrating Auth Users Between Supabase Projects](https://supabase.com/kb/troubleshooting/migrating-auth-users-between-projects).

## Integrated two-project rehearsal — PASSED on 2026-11-16

The further GitHub workflow [Reserve atomic Auth and business cutover rehearsal](https://github.com/venipublishing-main/venipublishing-website/actions/workflows/reserve-integrated-cutover-rehearsal.yml) now brings both earlier experiments together. It starts two **genuine, independent GoTrue/Auth + PostgreSQL + PostgREST** stacks and uses only synthetic `@example.invalid` identities. The Reserve application inputs are pinned to the same reviewed M1.1a/M1.1b/M1.2 commits as the earlier tests; the destination includes the Website Account Layer, Arcana pilot and isolated Reserve preview.

| One-run check | Observed outcome |
| --- | --- |
| Genuine Reserve login identities | Five users, five Auth identity records, all password hashes retained |
| Existing Website account and Arcana reading | Remained readable and unchanged |
| Reserve domain graph | Two tenants, four memberships, custom role, permission grants, private invitation and immutable audit entries retained |
| Import transaction | Auth users, identities, profiles and all Reserve domain records committed together |
| Forced error after some domain records | Complete rollback of imported Auth, profile trigger effects and Reserve rows; Website baseline intact |
| Original Auth UUID and password | All five synthetic Reserve users re-authenticated at Website with the same password and UUID |
| Cross-project JWT/refresh tokens | Source-issued tokens rejected at destination; new Website sessions required |
| PostgREST row-level security | Owners, custom assistant, staff, unassigned user and existing Website account restricted to authorised records |
| Account-deletion preflight | Owners required transfer; others with Reserve history blocked from direct deletion; Website-only user clear |
| Idempotency/replay | Repeat import preflight rejected a populated target |
| Original Reserve source | Still contains all five accounts, two tenants and original audit events |

**Scope boundary:** These M1 fixtures contain tenant/role/invitation/audit data, **not actual booking records**. Future booking/M2 tables, uploaded files, configured authentication hooks/providers, independent hosted/cross-project recovery and production staging remain **open gates**. A green synthetic run is not permission for a hosted migration.

**Hosted source table inventory (2026-11-16, read-only):** The Reserve staging project currently exposes exactly 10 application tables across `public` and `private`: `users`, `tenants`, `roles`, `role_permissions`, `permissions`, `memberships`, `membership_roles`, `audit_events`, `invitations`, `invitation_roles`. All 10 have RLS enabled. The integrated manifest covers the nine domain/relationship tables (including custom-role rows) and verifies equality of the seeded system-permission/role catalogue; thus, **no currently deployed Reserve application table is omitted** from this M1 rehearsal. Neither bookings nor tenant business settings are currently deployed as tables in this source inventory; future migrations must be inventoried afresh rather than assuming coverage.

## Disposable logical-backup recovery rehearsal — PASSED on 2026-11-16

The [integrated recovery run #43839340829](https://github.com/venipublishing-main/venipublishing-website/actions/runs/43839340829) first completed the same real-GoTrue/Auth and Reserve-domain import, then used PostgreSQL 17 `pg_dump`/`pg_restore` to recover the destination into a **new empty database on the same disposable PostgreSQL cluster**. The recovery verifier compared **47 Auth, Website, Arcana, Reserve and Storage-metadata tables** row for row by deterministic row-content fingerprints; every table matched, as did RLS enablement, policy definitions, application object ownership, grants to non-owner roles and application trigger definitions. A real `authenticated` Postgres role against the *restored database* could read only its expected tenant and encountered the owner-transfer-required deletion safeguard. The immutable audit trigger remained enabled.

**Important exclusions and limits:** Local Supabase prevented a normal database user from restoring protected `vault.secrets` ciphertext, modifying system/monitoring function grants, and resetting some `supabase_admin` default privileges. The rehearsal intentionally **omitted Vault secret data and platform-managed ACL/default privilege entries**, retaining application-level grants and Auth/Storage schema-access grants needed for RLS testing. Explicit *self-grants* can be represented differently after restore: the verifier compares the actual owner separately and all grants to other roles, rather than treating redundant owner self-grants as a permissions loss. It did **not** recover external Storage object bytes, Vault/root encryption keys, a cross-project database cluster with independent roles/extensions, GoTrue service configuration or new sign-in against the restored clone. The earlier **original destination** GoTrue login test, by contrast, did prove imported synthetic passwords and UUIDs work. This is therefore an **application database recovery proof only**, not a full Supabase project disaster-recovery certification.

The operator-facing [draft hosted cutover and rollback runbook](reserve-website-hosted-cutover-runbook-DRAFT-20261116.md) documents the remaining backup, encryption, credential, Storage, freeze and reversal gates. It is **review-only** and authorizes no hosted changes.

## Candidate approaches

| Option | User experience | Identity strategy | Principal risks / gate |
| --- | --- | --- | --- |
| A: Compatible selective Auth merge | Users sign in again with their **existing password**; no reset if verification passes | Preserve Reserve UUID and password hash, import required Auth identities | Must prove exact source/destination schema and identity compatibility, handle OAuth/MFA/SSO, verify zero UUID/email/provider collisions, prove rollback. Direct Auth SQL import requires careful review. |
| B: Website re-registration plus explicit account linking | Users register/re-authenticate for Website; possibly choose a new password | New Website UUID; an audited, proof-of-control mapping reparents Reserve foreign keys | Much wider referential rewrite; linking by email alone is forbidden. Require both-session proof, consent, ownership/audit continuity, replay protection. |
| C: Full Auth schema replacement | Potentially preserves source passwords and UUIDs | Replaces target Auth dataset with source | **Not acceptable as proposed**: would endanger existing Website users and identities. |

**Working preference:** Evaluate **A** through disposable hash-preserving merge tests first, because it could retain user history and passwords with fewer foreign-key changes. Do not select it for production until compatibility and failure-path gates are complete. Keep **B** as a controlled fallback.

## Deletion and long-term retention are separate problems

The draft `reserve_account_deletion_preflight()` checks only the **current authenticated user's** Reserve ownership/history and returns an explicit status. It cannot delete an account, transfer an organisation, anonymise reservations, or independently decide legal retention. The draft Website Edge integration requires `VENI_SHARED_RESERVE_DELETE_PREFLIGHT=enabled` and fails closed on missing/failed preflight; that flag has **not** been enabled.

Before go-live, design and verify a policy that distinguishes account closure, role removal, owner transfer, retained organisational business records, personal-data minimisation, and any lawful retention under POPIA/other applicable rules. Account deletion must never silently cascade through historical Reserve records. This requires an independent policy/legal review and end-to-end tests.

## Mandatory sign-off gates before any hosted change

1. **Inventory refresh:** compare real hosted Auth `users`, `identities`, `sessions`, MFA/provider configuration, verified emails, UUIDs, roles, and all public foreign keys. Read-only, redacted reports only; do not expose hashes, secrets, personal data, or tokens in Actions logs.
2. **Strategy review:** prove chosen option works for *every* actual provider/login type and collision case, including Website-owned accounts; document handling of unlinked identities and user consent.
3. **Source/destination schema compatibility:** compare actual hosted Auth versions, generated columns, constraints, `auth.identities` formats, auth-hook and trigger behaviour, then recreate in disposable databases.
4. **Deep data reconciliation:** tenant memberships, permissions, invitations, audit rows, foreign-key integrity, history, ownership, and Website profiles must survive import.
5. **Security regression:** real Auth, JWT rejection, re-login, tenant isolation, RLS, permissions, owner deletion, negative email collision and fail-closed cases.
6. **Backup, rollback, and write-freeze:** independently restorable destination and source backups, deterministic replay, rehearsal of failed import and recovery, defined freeze window, and monitoring plan.
7. **Website acceptance:** Ian signs off on genuine end-user walkthroughs, including normal and failure flows.
8. **Explicit cutover authorization:** separate approval **after** gates 1–7; only then schedule hosted migration, switch app configuration, monitor, and much later consider retiring Reserve.

**No-Go:** The old Reserve Supabase project must remain intact and available for recovery. Creating drafts, running synthetic CI, or approving a schema does not authorize production import or source shutdown.
