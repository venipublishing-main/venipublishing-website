# Transfer Veni Reserve into the primary Veni Publishing Supabase project

**17 November 2026 — implementation handoff (not yet applied to hosted database).**

## Correct scope

Reserve has **not launched** and has **zero customer accounts**, bookings, or customer storage objects. The separate staging project is a development database, not an operating service. Do not spend time designing customer-record migration, identity-matching campaigns, account-reset mailouts, or a production cutover.

- **Source:** `vf-reserve-stg` — `opjgaepryqwmsohtajja`, 3 hosted M1 foundation migrations, 2 test tenants, 5 test Auth identities.
- **Destination:** Veni Publishing's existing project — `droslqfcazwkwvqlbtsq`, already contains Website and Arcana tables and 1 real Website Auth identity.
- **Goal:** all ongoing Reserve development uses the **destination Supabase database and Auth**, while the Reserve application remains a separate product under Veni Flow. Performance/Sports stays paused until Reserve no longer needs its separate active staging project.
- **Existing data:** create Reserve structure and permission catalog in destination; do **not** import source's 2 synthetic tenants, 5 test identities, or associated test memberships/audit events. Existing Website/Arcana entities must remain unchanged.

## Transfer implementation

1. **M1 foundation:** `supabase/transfer-candidates/reserve_m1_shared_hosted_candidate.sql` contains the full namespaced conversion of Reserve's three *actually deployed* M1 migrations, including tenant, user, role, permissions, membership, invitation, and audit relations and tenant RLS. It creates `reserve` and `reserve_internal` without replacing any `public` Website/Arcana table. Its 10 application tables and permission catalog are newly created; it does not copy staging test rows.
2. **Still-local Reserve features:** M2.1 business settings, M2.2 bootstrap, M7 private themes, and M2 Locations, Services, and Staff are in Reserve source/draft branches, **not** in the staging hosted migration history. Integrate those features into the **same destination namespace** as soon as they are merged for development. Existing conversion/test code lives in Website draft PRs [#2](https://github.com/venipublishing-main/venipublishing-website/pull/2), [#14](https://github.com/venipublishing-main/venipublishing-website/pull/14), [#16](https://github.com/venipublishing-main/venipublishing-website/pull/16), [#18](https://github.com/venipublishing-main/venipublishing-website/pull/18); the later Reserve drafts extend to [#30](https://github.com/venipublishing-main/veni-reserve/pull/30).
3. **Application wiring:** set Reserve's deployed/server environment to the *destination* Supabase project URL/publishable key, never a source key; use destination Auth JWTs; update Reserve queries to address `reserve` data and reserve-prefixed public RPC wrappers, with RLS/session checks. Do not configure public Data API exposure of private schemas. This is separate from the SQL transfer and **not yet done**.
4. **Verification:** confirm destination `reserve`/ `reserve_internal` structure, permission seed counts, exact absence of imported test tenants/users, and unchanged Website/Arcana data; then test bootstrap, tenant boundaries, settings, themes, locations, services, and staff using *new dev fixtures on destination*. Keep staging available until this succeeds.
5. **Retire source:** only after Reserve points to destination and works, pause the separate `vf-reserve-stg` project to free the Free-tier slot for Sports. Do not delete the project or copy test identities.

## Why this package is not already live

The attempted transactional hosted rehearsal was blocked by the database-access approval guard because the SQL creates tables, functions, grants, and RLS policies in a shared database, even if the transaction ends in `ROLLBACK`. We stopped; no hosted database mutation was made. This is a **specific hosted-write approval boundary**, not a missing customer-migration task.

To proceed, obtain explicit authorisation for this exact operation:

> Apply the reviewed additive Reserve M1 schema and permission migrations to the existing Veni Publishing Supabase project `droslqfcazwkwvqlbtsq`, creating only `reserve` and `reserve_internal` objects, without importing staging users/data, deleting anything, pausing either project, or changing Website/Arcana objects.

Once authorised, use the pinned package, inspect any target naming collisions, and verify the resulting objects. Keep the SQL in the candidate directory until the approved hosted operation is confirmed and corresponding schema migration history is committed. Future Reserve feature migrations follow afterward.

## Evidence

- Source deployed versions: `20261030154642`, `20261030174937`, `20261031031256`; destination deployed versions: `20260903071048`, `20260903072229`.
- Source M1 Git blob SHAs: `ab260eda829c7bd10af2cdc2e70c948e89d388e0`, `050b7edc6f194d2990cc23ff1fe39b6b34dec5e2`, `3593761e05bdca08c8da9a6f2b691a6e0290868c`.
- Website PR #2 has already run the local namespace conversion and security tests; this is a prepared hosted bundle, **not** proof of deployment.
- Read-only Supabase checks on 2026-11-17 confirmed: destination `auth.users = 1`, `arcana_cards = 6`, Storage objects = 0; source `auth.users = 5`, `public.tenants = 2`, `public.memberships = 4`, `audit_events = 10`, Storage objects = 0.
