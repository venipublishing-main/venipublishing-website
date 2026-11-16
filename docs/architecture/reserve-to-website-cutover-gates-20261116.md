# Reserve → Website: source-to-destination cutover rehearsal

**Date:** 16 November 2026  
**Status:** Synthetic CI proof passed; **NOT** cleared for hosted cutover  
**Stacked draft:** https://github.com/venipublishing-main/venipublishing-website/pull/4 (builds on draft PR #2)

## Boundary

- The **Veni Website** remains the parent account portal. Veni Flow / Reserve is a separate domain with its own tenant, role and audit boundaries.
- The existing Website Supabase project is the *candidate* shared physical database, not a universal access policy or permission shortcut.
- Reserve live staging is still a separate Supabase project; **no hosted writes, migrations, Auth changes or client switching were made**.
- Until a separately approved deployment, **do not shut down, pause or delete the Reserve project**. Keep it available as the authoritative source and rollback option.

## Verified disposable rehearsal

The workflow `reserve-synthetic-import-rehearsal.yml` creates **two separate PostgreSQL 17 databases**, one with the **three Reserve M1 migrations actually deployed** (not the still-unhosted M2.1), the other with the Website account and Arcana pilot plus the converted Reserve M1/M2 preview. A pinned, non-real dataset contains:

| Domain | Synthetic source records | Rehearsal rule |
| --- | ---: | --- |
| Auth identities | 5 | UUIDs and emails copied only for the local mock Auth schema; 2 existing Website users kept |
| Reserve identities | 5 | Same UUID as the account owner; no alternate shadow identity |
| Tenants | 2 | IDs/status/creation timestamps preserved |
| Memberships/assignments | 4 + 4 | Tenant/user/role references preserved, active-owner check committed under SERIALIZABLE |
| Custom roles/mappings | 1 + 2 | System permissions catalogue reconciled before import; custom grants kept |
| Private invitations/roles | 1 + 1 | Issuance transaction ID regenerated, secret *verifier* and historical values compared |
| Audit events | 2 | Audit event time and content preserved; insert trigger briefly disabled inside the disposable atomic transaction and re-enabled |
| Website/Arcana | Existing | Original profiles, entitlement, product and reading remain in place; onboarding trigger makes new profiles |

Every copied table is compared back to source using deterministic PostgreSQL CSV exports. The script refuses any source Auth population except five `@example.invalid` test identities, and will only run against explicitly marked local loopback databases.

**Failure/rollback evidence**:

1. Collision checks refuse duplicate UUIDs, case/whitespace-normalized duplicate emails, a divergent system role/permission catalogue or a nonempty Reserve target.
2. A deliberate error partway through the serializable import leaves **zero** new Auth, Website profile or Reserve rows.
3. The full import commits, and Owner A, custom assistant and a pre-existing Website-only account pass tenant-level RLS checks.
4. A second attempt is refused without modifying the committed result.
5. A **pre-import Website backup** produced by PostgreSQL 17 `pg_dump` is restored into a **third disposable database**, where the original baseline checks pass.

The existing `reserve-shared-supabase-prototype.yml` checks remain green. Neither workflow touches the hosted projects.

## What this does **not** prove

- **Real Supabase Auth migration:** copying rows into mock `auth.users` does not migrate GoTrue password hashes, identity-provider links, MFA, refresh tokens, sessions, email confirmations or OAuth consent. A documented supported approach is required; users may need a controlled re-authentication or password reset. Never claim existing sessions are portable.
- **Live data shape and delta handling:** the rehearsal uses exact M1 source schema plus deliberate synthetic data; a real migration must re-inventory and freeze source writes, reconcile source-to-target row counts and hashes, ensure no UUID/email collisions, and handle any new migrations after this date.
- **Standalone exit:** Reserve domain tables can be extracted in PR #2, but independent Auth/account migration, storage, external integrations and payment migration must be separately exercised before claiming full portability.
- **Deletion compliance:** current Website `delete-account` directly calls `auth.admin.deleteUser(user.id,false)`, while Reserve's projection references `auth.users` with `ON DELETE RESTRICT`. Even a **revoked** membership can retain immutable audit links. The verified behavior is a blocked hard delete; no approved retention/anonymisation/ownership-transfer orchestration exists yet. Do not silently drop historic foreign keys or bypass them.
- **Production restore:** a local pre-import snapshot restored to a third database does not substitute for a tested production-grade backup, recovery time limit, external storage backup, secrets inventory or a coordinated client rollback.

## Mandatory gates before any real switch

1. **Define account lifecycle** with an explicit user-facing deletion request, ownership-transfer requirement, audit retention/legal review, personal-data minimisation and revocation of active access. Test revoked as well as active memberships and stale JWT behavior. The existing Edge Function must not report a generic retry when deletion is structurally blocked.
2. **Choose and exercise Auth migration** using genuine disposable GoTrue/Auth and PostgREST, including email/password, OAuth/PKCE, provider identities, email confirmation, session invalidation, and account linking. Capture consent/login behavior and identity mapping without exporting real credentials to CI.
3. **Freeze and inventory source** again: new columns, current PRs, Auth identities, normalized-email/UUID collisions, memberships, audit, Storage, Edge Functions, secrets, OAuth callbacks, tenant settings and any external providers.
4. **Prepare backups and recovery** for both hosted projects, with independent verification, runbook, declared rollback point, owners, acceptable downtime and a stop/go decision.
5. **Run a supervised staging cutover** for all real domain data and auth links. Prove count/hash parity, two-tenant RLS, original Website identities, onboarding, Reserve SSR and Arcana entitlements. Prevent simultaneous writes to old and new backends.
6. **Explicit owner approval** is required to deploy migrations, change any environment variable, update clients, redirect OAuth traffic, or retire the old Reserve Supabase project. Do not delete the old project until a separately agreed observation and recovery window has ended.

## Recommended next engineering slice

Build the **shared account deletion preflight and recovery workflow** as a separate draft (no hosted deployment): detect Reserve ownership/history, block unsafe direct deletion, establish the retention policy and use integration tests for both unlinked Website-only accounts and linked Reserve accounts. In parallel, design the **real GoTrue identity cutover** before attempting any production data transfer.
