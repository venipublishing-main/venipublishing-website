# Veni Account: Reserve to Website hosted cutover runbook

**DRAFT ONLY · 2026-11-16 · Not an instruction to execute a hosted migration**

The destination is the existing Website project (`droslqfcazwkwvqlbtsq`); the source is the existing Reserve project (`opjgaepryqwmsohtajja`). Both are currently operational. **Do not pause, delete, modify, redirect, or retire Reserve as a result of this document.** Every production action below requires a separately authorised migration window following the gates in this runbook.

## 0. Decisions, ownership, and stop conditions

- **Owner/approver:** Ian van Vollenhoven; approve the exact timeline, expected downtime, account-login experience, and rollback criteria in writing. Development approval is *not* cutover approval.
- **Operator:** a named engineer with time-limited access to both projects; **verifier:** a different reviewer (where available) to sign off reconciliation and security tests.
- **Selected strategy for rehearsal:** compatible, *selective* merge of Reserve Auth users and identities into Website Auth without overwriting existing Website users, with their original UUIDs and password hashes; import only the Reserve domain tables required by the inventory. Alternative linking/re-registration strategy remains a fallback, not an implicit decision.
- **Strict no-go:** any UUID, normalised-email, provider-identity or profile collision; schema/provider incompatibility; bookings or Storage objects absent from the manifest; incompatible hooks or login methods; missing recovery evidence; broken tenant access; absent owner signoff; or source/target backups that cannot be restored.
- **Live-user implications:** old Reserve JWT and refresh sessions will not become Website sessions; communicate a fresh sign-in even if password hashes can be retained. Do not ask users to disclose existing passwords to migration operators.

## 1. Read-only preflight — refresh immediately before the window

1. Resolve the *actual* source and destination project references, status, plan limits, PostgreSQL/Auth versions, migrations, all schemas, extensions, roles and grants. Use read-only queries and record timestamped, access-controlled evidence.
2. Re-inventory source and destination Auth users/identities, all active and dormant providers, MFA, sessions, email verification, redirect settings, hooks, profile triggers and custom claims. Compare IDs, normalised email and provider-identity keys for collisions **without logging personal data or password hashes**.
3. Re-inventory every application table, row count and foreign key, including any new bookings, payments, settings, invitations, audit, membership, product entitlements and Arcana history; confirm M1-only rehearsal coverage has not become stale.
4. Compare permission catalogues, constraints, indexes, triggers, security-definer functions, RLS, policies, `GRANT`s, Storage bucket metadata, policies, object bytes and signed-URL integrations. Any drift restarts review and rehearsal.
5. Review external services: website/Reserve API variables, domains, webhooks, cron, Edge Functions, SMTP/email templates, OAuth callbacks, billing processors, file attachments, Google services and monitoring. Nominate who will freeze each producer.
6. Get a written data-retention and deletion treatment for organisational records and personal data. An owner must transfer/resolve organisations before account deletion; do not automatically cascade-delete bookings or audit history.

**Gate A:** publish a redacted compatibility/delta report with exact table and provider coverage. Approver explicitly accepts any *documented* exceptions; unknowns are no-go.

## 2. Recovery assets — prepare and independently rehearse

1. Record destination and source *point-in-time-consistent* database restore points or export snapshots, with database schema/data (including Auth and Storage metadata) and extension/role definitions. Record timestamps and encrypted checksums outside workflow logs. Determine whether managed database backups permit the required point-in-time recovery on the actual plan.
2. Back up **external Storage object bytes separately**: PostgreSQL Storage metadata alone is insufficient. Verify each private/public bucket, object checksum, size, content type and access policy through an authorised route.
3. Catalogue **project configuration not contained in PostgreSQL dumps**: Auth JWT/signing and email configuration, custom domains, API environment variables, Auth hooks, SMTP/OAuth credentials, Edge/cron secrets, Storage endpoints, Vault encryption/root keys, global roles/ownership, extensions and replication. Transfer/manage these with the service's approved mechanisms; do not export raw secrets into CI, chat or PRs.
4. Restore *both* protected snapshots into an independently isolated staging environment, including global roles and required extensions. Validate object access, logins with controlled test accounts, RLS, history and critical flows. Encrypt and restrict access to staging backups; securely expire the temporary environment under approved retention policy.
5. Prove **destination rollback** from the protected restore point. Define a separate route to recover the still-intact source. Do not assume a dump into another database **on the same cluster** proves cross-project recovery, live GoTrue recovery, or Storage recovery.

**Known local-recovery limitations (identified in CI):** A direct whole-database `pg_restore` under the normal local database login was refused permission to write `vault.secrets`, modify the protected `extensions.pg_stat_statements_reset` and `pg_catalog.pg_reload_conf` grants, and set default privileges owned by `supabase_admin`. The disposable recovery experiment excludes the Vault ciphertext payload and Supabase-owned privileges rather than elevating permissions; the operator must independently provision and verify equivalent platform configuration in a future cross-project staging rehearsal. The continued application-record, policies, roles and data checks do **not** imply these protected assets have been recovered.

**Independent-cluster rehearsal (draft PR #6, 2026-11-16):** [CI run #43848145142](https://github.com/venipublishing-main/venipublishing-website/actions/runs/43848145142) recovered the same **47 synthetic application/Auth/Storage-metadata table datasets** onto a *third physical PostgreSQL instance*, reconciled row fingerprints, RLS, policies, triggers, grants, restricted custom-role properties, security-definer ownership, tenant access, audit protection and deletion preflight. Because custom Postgres roles are cluster-global, the restore first recreated the least-privilege `reserve_settings_executor` and temporarily granted/revoked `SET ROLE` plus private-schema `CREATE` to restore original function ownership; it verified no elevated membership remained.

**Auth-specific recovery gate passed locally (2026-11-17):** The previous third native Supabase GoTrue service successfully signed in all six recovered synthetic UUIDs after importing `auth.users`/`auth.identities` into its compatible Auth catalogue. The further [independent full-clone CI run #44007658384](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44007658384) now **also** starts a new GoTrue process directly on the *entire* restored PostgreSQL database, and all six original passwords/UUIDs work there. The critical fix was using an **Auth-first connection `search_path=auth,public`** so the service finds the already populated `auth.schema_migrations` ledger rather than replaying an incompatible OAuth migration. The test mirrored the pinned CLI v3 Auth image/command and generated a **new, isolated JWT secret**; the old Website JWT was then rejected. An unrotated standalone test had accepted that old token, so signing-key/keyset rotation and old-session rejection must be verified explicitly. No migration-history edits, weakened RLS or production secrets were used. This proves local synthetic GoTrue restart and credential preservation, **not hosted recovery**. Neither this rehearsal nor a green Actions badge satisfies Gate B for real hosted snapshots, Storage bytes, Vault keys or provider configuration.

**Gate B:** record the measured backup and restore times, the actual recovery point and timeout, and independent verifier signoff. A green synthetic CI result does not satisfy this hosted gate.

## 3. Freeze and import — only during a separately approved window

1. Announce planned downtime and the requirement to re-authenticate to affected users. Record explicit approval, operators, rollback decision-maker, maintenance-page wording and a maximum tolerated freeze duration.
2. Stop **all writers** to both projects, including website signups, Reserve actions, queued jobs, scheduled tasks, callbacks, payment/booking events and custom scripts. Keep both databases and backups accessible. Confirm no new transactions are arriving.
3. Take final consistent snapshots/checkpoints *after* freeze and rerun collision, table-count and configuration preflight. Abort on any unexplained delta or unquiesced writer.
4. Apply the reviewed, pinned schema preview to the destination only after final approval. Retain Website/Arcana objects unchanged and Reserve objects namespaced. Verify migration is idempotent and target Reserve domain is empty where expected.
5. Import compatible source Auth users and identities and all required domain/relationship records with a transactionally consistent approach, preserving UUIDs, password hashes, ownership, invitations, immutable audits and business-history foreign keys. Fail closed on collisions; ensure source data is unchanged. Store any temporary confidential transfer material in approved encrypted storage, not GitHub Actions artifacts.
6. Move linked external Storage objects with object checksums and correct policy/ownership references. Handle the distinct namespace, signatures, URLs and destination credentials explicitly.
7. Reconcile row counts, source-to-destination stable identifiers, role and permission catalogues, foreign-key integrity, record hashes, booking state, audit immutability, Website accounts, profiles and Arcana history. Run tenant-isolation and denial-path tests with genuine target-issued Auth sessions.

**Gate C:** zero unexplained deltas, green functional/security verification, and named verifier approval **before switching traffic**. Otherwise leave Reserve untouched and restore the destination from the approved snapshot.

## 4. Controlled traffic switch and monitoring

1. Redirect only the reviewed Veni app/API client configuration to canonical Website Auth/API endpoints; rotate/configure secrets through approved controls. Update redirect URLs, callbacks, email/SMTP and Storage access as needed; never publish service-role keys in client bundles.
2. Smoke-test sign-in for a controlled migrated Reserve account using its **existing password but a new Website session**, a Website-only account, a tenant owner, staff/assistant, an unauthorised user and a signed-out visitor. Verify correct sub-product navigation, cross-tenant denials, bookings, ownership, invitation flows, deletion guards and Arcana history.
3. Re-enable writers **only after** live smoke tests pass. For a defined observation window, monitor authentication failures, RLS denials, API errors, data writes, Storage access and business workflows; log counts and error codes without leaking personal data.
4. Keep old Reserve **online, protected and read-only from the application side** as an emergency recovery source. Do not make the original and new backends independent writable masters; do not pause or delete the project during early monitoring.

**Gate D:** explicit user acceptance after the monitored period. Source retirement is a *later*, separate decision with independent backup, retention and cost review.

## 5. Failure response and rollback

- **Before accepting new writes:** stop the switch, maintain the freeze, restore the destination to its verified pre-import point and point clients back to the still-unchanged Reserve project. Confirm the original Website/Arcana account and records survived.
- **After new Website writes are accepted:** immediately freeze *both* directions; record the target-only changes, reconcile them with the previous source snapshot and choose an approved delta migration or recovery path. **Do not blindly restore an old target snapshot or reverse the switch**; that would discard legitimate bookings, profiles or payments.
- **Security breach/collision/incomplete import:** abort and escalate; preserve audit and forensic evidence in a restricted store; do not retry with ad-hoc SQL or disable RLS. A replay requires renewed preflight and approval.
- Record incident timeline, people authorising each step, last known good backup, successful re-login verification and final data reconciliation.

## 6. Evidence register — current and remaining

| Gate | Current evidence | Status |
| --- | --- | --- |
| Real hosted schema/Auth inventory | 2026-11-16 read-only audit; 5 source and 1 destination accounts, 10 M1 tables | **Historical snapshot; must refresh** |
| Synthetic Auth + full M1 domain import | Two independent local GoTrue stacks, preservation/rollback/RLS passed in PR #5 | **Passed in CI only** |
| PostgreSQL application/Auth/Storage metadata and rows restored to clean database | [CI run #43839340829](https://github.com/venipublishing-main/venipublishing-website/actions/runs/43839340829): 47 datasets, RLS/policies, object owners, grants to other roles, triggers and deletion guard; same disposable cluster; Vault secret data excluded | **Passed locally; hosted proof open** |
| Independent-cluster synthetic database recovery | [CI run #43848145142](https://github.com/venipublishing-main/venipublishing-website/actions/runs/43848145142): 47 tables, restricted role recreation, application function owners, policies/RLS and deletion protections matched on third PostgreSQL server | **Passed in disposable CI only** |
| Independent third-stack Auth credential continuity | [CI run #43848145142](https://github.com/venipublishing-main/venipublishing-website/actions/runs/43848145142): six recovered synthetic identities signed in via third native GoTrue with original UUID/password; old Website JWT rejected at its API endpoint | **Passed in disposable CI** |
| Full independently restored database + direct GoTrue Auth restart | [CI run #44007658384](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44007658384): same pinned Auth image directly on complete cross-server clone; verified Auth-first session search path, six UUIDs/passwords and new JWT sessions; old Website JWT rejected after synthetic signing-secret rotation | **Passed in disposable CI; hosted proof open** |
| Real hosted/staging backups, Auth provider configuration, privileged ACLs and Vault recovery | No real hosted snapshots, OAuth/MFA/SMTP, Vault/root keys or Storage object bytes were transferred or restored. Local GoTrue proof cannot substitute for those operations. | **Open / no-go** |
| Storage object bytes and newly deployed bookings | Not covered by M1 fixture; must inventory | **Open** |
| Hosted data migration and end-user signoff | Not conducted, not authorised | **Open** |
| Reserve hosted project closure | Explicitly excluded | **Not authorised** |

### Related draft work

- [Identity strategy and audited gates](reserve-website-auth-cutover-options-20261116.md)
- Draft PR #2: <https://github.com/venipublishing-main/venipublishing-website/pull/2>
- Draft PR #4: <https://github.com/venipublishing-main/venipublishing-website/pull/4>
- Draft PR #5: <https://github.com/venipublishing-main/venipublishing-website/pull/5>
- Draft PR #6: <https://github.com/venipublishing-main/venipublishing-website/pull/6>
- Draft PR #7: <https://github.com/venipublishing-main/venipublishing-website/pull/7>
