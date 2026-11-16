# Veni Account — Hosted Supabase migration readiness: verified inventory and gates

**Date:** 16 November 2026 (SAST)  
**Status:** Read-only hosted inventory, draft implementation runbook. **Not authority for a hosted migration, production OAuth activation, project pause, deletion, or cutover.**

## Scope and identity boundary

Veni Publishing Website is the parent account portal and the proposed **existing** shared Supabase destination. Veni Flow > Reserve is an independent child Sphere; Performance remains paused/excluded; Arcana must be preserved. The merger must be reversible and must retain Reserve's tenancy, permissions, and audit semantics. One Supabase Auth identity does **not** imply Reserve membership, Arcana entitlement, or cross-origin browser SSO.

Both Veni Supabase organizations were independently confirmed to be on the **Free** plan. Do not create a new Supabase project or upgrade to a paid plan. Ian reports he is not using Reserve until the consolidation is ready; this is **not consent to discard any user or business data**.

## Projects and exact inventory (read-only connector inspection)

| Item | Veni Publishing destination | Reserve staging source |
|---|---|---|
| Project | `droslqfcazwkwvqlbtsq` — Veni Publishing's Project | `opjgaepryqwmsohtajja` — `vf-reserve-stg` |
| Organization | `bqfmagskxosyqqjlwvvn` (Free) | `urtmqxqvbtuiqrqmxkbf` (Free) |
| Status | ACTIVE_HEALTHY | ACTIVE_HEALTHY |
| Region | `eu-central-1` | `eu-west-1` |
| Database | PostgreSQL 17.6.1.166 | PostgreSQL 17.11.0.003 |
| Applied app migrations | `20260903071048` revoke RPC access; `20260903072229` Arcana foundation | `20261030154642` M1.1a; `20261030174937` M1.1b; `20261031031256` M1.2 |
| `auth.users` / `auth.identities` | **1 / 1** (email provider; 1 confirmed) | **5 / 5** (email provider; all 5 confirmed) |
| `auth.sessions` | **2** records; not proof they remain valid | **0** |
| `storage.buckets` / `storage.objects` | **0 / 0** | **0 / 0** |
| Hosted Edge Functions | `delete-account` v2 ACTIVE | None |

Exact **Website** application counts: `public.profiles=1`, `products=2`, `entitlements=0`, `arcana_cards=6`, `arcana_readings=0`, `arcana_reading_cards=0`, `arcana_journal_entries=0`.

Exact **Reserve staging** counts: `public.tenants=2`, `users=5`, `memberships=4`, `roles=4`, `permissions=53`, `role_permissions=132`, `membership_roles=4`, `audit_events=10`, `private.invitations=0`, `private.invitation_roles=0`.

**Source distinction:** Reserve's hosted staging schema contains only the three M1 migrations. The M2.1 business-settings migration exists in Reserve `main` and in Website draft PR #2's local merger prototype, **not** in the hosted source inventory. Reserve draft PRs #16/#20/#22/#23/#24 are not merged/hosted and cannot be silently assumed live. The available connected Supabase inventory showed no other Veni Reserve instance; do not infer that no independently managed production instance could exist.

## Evidence-backed blockers

1. **Identity mapping, not blind copying.** The destination has one confirmed Auth user and a live `public.handle_new_user` trigger; source has five confirmed Auth users. A naïve database restore, user UUID rewrite, or re-registration could break `reserve.users.id -> auth.users(id)`, credentials, identities, profiles, or audit relationships. A privacy-limited read-only comparison of normalized-email and user-UUID SHA-256 fingerprints on 16 November 2026 found **zero overlapping emails and zero overlapping UUIDs** between Website's 1 account and Reserve's 5 accounts. The comparison discarded all fingerprints immediately; no underlying email addresses or IDs were printed or committed. Repeat the collision check at cutover and preserve a reviewed mapping for every source identity.
2. **Shared account deletion conflict.** The active Website `delete-account` Edge Function calls `auth.admin.deleteUser(user.id,false)`. Source `public.users.id` uses `ON DELETE RESTRICT`, while Website `public.profiles.id` uses `ON DELETE CASCADE`. Website draft PR #2's disposable integration test explicitly reproduces the foreign-key deletion blocker. Define a reviewed, audited deactivate/export/delete lifecycle for Reserve tenant and audit retention **before** enabling a shared delete control.
3. **Security boundaries.** Source private helper functions include narrow `SECURITY DEFINER` role/capability checks and exposed-table RLS policies; website Arcana/profile tables also enforce owner-specific RLS. Do not merge public tables into one namespace or broaden generic grants. Destination's `handle_new_user` trigger must continue to work.
4. **Revoked access tokens.** Website draft PR #2 demonstrated that an old JWT can remain usable after sign-out; a disposable session-aware RLS/RPC mitigation passed, but is **not a reviewed hosted migration**. Apply consistent reviewed live-session checks to all sensitive Sphere paths, including Security Definer RPCs.
5. **Preview and deployment gaps.** Website PR #2 locally proves namespaced M1+M2.1 and a data-domain extraction; Website PR #3 remains inactive, with an empty OAuth client allowlist. Reserve PR #24 proves a real local OAuth2/PKCE protocol loop, **not** the Website consent page in a human browser. Production allowlist, sign-in handoff, Secure cookies, OIDC/JWKS, app entitlement controls, and HTTPS deployment remain gated.
6. **Advisors.** Both projects warn that leaked-password protection is off; review availability and priority under the $0 constraint. Reserve advisor INFO flags RLS with no policies on `public.permissions`, `private.invitations`, and `private.invitation_roles`; deny-all may be deliberate, so validate grants and intended internal access before treating it as a defect. No security settings were changed.
7. **Version/region mismatch.** Both run PostgreSQL 17, but the source minor version is newer and the two projects are in different EU regions. Review schema compatibility, backups, any data-residency/consent implications, and timeouts before rehearsing a cross-project transfer.
8. **No free managed clone.** Supabase's `Restore to a new project` feature requires paid-plan physical backups and clones to a new project, not an existing partly populated one. Under our $0 and existing-target design, plan **manual, narrowly scoped logical backups and a verified staged import** rather than project overwrite.

## Ordered implementation gates

1. **Freeze the inventory and review branch dependencies.** Reconcile exactly the three hosted Reserve migrations with M2.1 and the unmerged PR #20/#22 business/theme functionality. Review source DDL, functions, grants and all FK directions; keep the Website's two existing migrations and seven tables unchanged.
2. **Obtain secure reversible backups before ANY hosted write.** For each Free project, produce version-appropriate logical exports using the current Supabase CLI help/documentation, including schema/roles/data and the relevant Auth identities, plus separately capture server configuration. Store encrypted copies outside public source control; verify successful restore to a disposable isolated instance. This step has **not** yet been executed.
3. **Design an identity reconciliation manifest.** Compare confirmed Auth identities in a private, controlled workspace; determine collisions using normalized identifiers, map old UUIDs to canonical destination UUIDs, and specify credential/session reset behavior and rollback. Use synthetic users to test conflict paths; never hardcode real emails or tokens into repo tests or Google Docs.
4. **Extend the disposable local merger.** Reuse SHA-pinned Website PR #2 `reserve.*` / `reserve_internal.*` and bounded `public.reserve_*` adapters; incorporate the reviewed post-M2.1 Reserve migrations in dependency order. Preserve owner/audit invariants and separately removable roles/RPCs. Build session-aware permissions and account deletion lifecycle orchestrator.
5. **Run end-to-end acceptance.** Verify parent account + Arcana unaffected; both Reserve tenant owners' isolation; all row counts, FKs and audit history preserved; owner/member revocation, sign-out stale-JWT denial, no user-metadata privilege escalation, restore/extraction and rollback. Browser-test Website consent and Reserve SSR with real local Supabase Auth/PKCE, deny/approve and expiry/revocation.
6. **Separate approval gate for hosted destination changes.** Only after fully reviewed backups, migration SQL and dry-run evidence: obtain Ian's specific authorization for the exact Website project, database changes, Auth users and any OAuth registration. A generic “proceed” must not be interpreted as permission to overwrite the hosted database or start a billing plan.
7. **Controlled cutover and observation.** Apply the approved reviewed migration to the existing Website project, verify counts/checksums and cross-Sphere authorization, update only the approved Reserve client configuration, monitor and exercise rollback. Keep Reserve staging intact and usable as a fall-back until separate acceptance.
8. **Retirement only by later explicit decision.** After sustained production verification and a tested rollback/restore, Ian can separately approve pausing the old Reserve staging project. **Do not delete or deactivate it now.** Performance remains paused and excluded.

## Traceability and official sources

- Website local shared-backend draft PR #2: https://github.com/venipublishing-main/venipublishing-website/pull/2
- Website inactive parent OAuth consent draft PR #3: https://github.com/venipublishing-main/venipublishing-website/pull/3
- Reserve OAuth real local-provider draft PR #24: https://github.com/venipublishing-main/veni-reserve/pull/24
- Canonical merger blueprint: https://docs.google.com/document/d/1SF0VqLmbFcXHVYVRza5CWTTLc9L_4iiMwR98Mq6Fz08
- Free-project manual backups: https://supabase.com/docs/guides/platform/backups
- Restore-to-new-project paid limitation: https://supabase.com/docs/guides/platform/clone-project
- Supabase account deletion / Auth data: https://supabase.com/docs/guides/auth/managing-user-data
- Supabase CLI v3 hosted flag/confirmation changes (4 Nov 2026): https://supabase.com/changelog/supabase-cli-v3

**Audit effect:** documentation only, no hosted database rows, schema, Auth users, API keys, functions, settings, DNS, or deployment modified.
