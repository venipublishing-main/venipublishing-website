# Reserve-first shared Supabase prototype — M1 + M2.1 previews

**Status: LOCAL-ONLY, unmerged proposal. No live database changes.**  
Date: 15 November 2026. Owner: Veni Publishing.

## Product hierarchy

The **Veni Publishing website is the parent portal**, with the single Veni Account Layer serving all Spheres. Veni Flow contains Reserve and Performance; Arcana and other Spheres are siblings of Flow. The Supabase project is shared backend infrastructure, **not** the visible parent of the website. This implements the ratified DEC-013 interface direction without collapsing independent repos or deployments.

## Aim and boundaries

Destination eventually: existing Veni Publishing Supabase `droslqfcazwkwvqlbtsq`; do not create a fourth project or pay for a new plan. Source: Reserve staging `opjgaepryqwmsohtajja`. Performance `tdiiuqbagclwknlmdlfb` remains paused and excluded.

Two generators provide an **offline preflight** of the three Reserve M1 migrations actually deployed to staging and the later M2.1 business-settings migration merged into Reserve `main` (but not yet hosted at the audit). They produce four reviewable SQL previews for `reserve.*`, `reserve_internal.*` and two bounded `public.reserve_*` RPCs, preserving the existing website's accounts/Arcana. Neither generator connects to Supabase or runs SQL.

It still intentionally excludes Reserve's **unmerged** PRs #20 and #22 (and their stacked prerequisite branches). Those must be reconciled and integrated in order, in coordination with ongoing Reserve development, before any complete migration can proceed.

## Repeatable developer procedure

1. Check out `venipublishing-main/venipublishing-website` and `venipublishing-main/veni-reserve` in adjacent folders. Verify all four pinned SQL Git blob digests and fail on drift. M2.1 `20261103160923_tenant_business_settings.sql` is pinned to `bdca9ea088e2b48095fac38ad5ef728f086042d3`.
2. In the **website** repository, run `node --test tests/merge-reserve-m1.test.mjs tests/merge-reserve-m2.test.mjs` (only built-in Node libraries; no packages or credentials).
3. Run `node scripts/merge-reserve-m1.mjs --reserve-root ../veni-reserve --out-dir ../reserve-merger-preview` followed by `node scripts/merge-reserve-m2.mjs --reserve-root ../veni-reserve --out-dir ../reserve-merger-preview`. This produces four `preview-*.sql` files **outside** `supabase/migrations`. The output directory must not already contain those filenames, to avoid accidental overwrite.
4. Read the generated SQL diff, especially RLS policies, helpers and privileges. Run in a disposable **local** PostgreSQL/Supabase integration stack against a faithful copy of the website schema. The generator's static tests are **not database execution tests**.
5. Confirm `public.profiles`, `public.products`, `public.entitlements` and all `public.arcana_*` tables are unchanged. Run tenant A/B cross-read/write-denial, authenticated/anonymous/revoked-access checks, owner/audit invariants, and the original Reserve pgTAP suite. Check `auth.users` linkage and deletion behavior.
6. Only once the full pipeline is green, use the installed **Supabase CLI's current `--help`** to create a real versioned migration via `supabase migration new ...` and compare its contents against the reviewed preview. CLI v3 changed defaults in November 2026. Keep this initial PR draft until verified.

## Automated disposable PostgreSQL rehearsal

The draft PR contains an **actual PostgreSQL 17 GitHub Actions integration job**, not only static SQL checks. It loads the pinned website foundation, website sign-up/RPC hardening and Arcana pilot, applies three Reserve M1 previews, seeds two synthetic owners and then applies the M2.1 preview. It uses a minimal mock `auth` schema instead of connecting to a hosted Supabase project. CI asserts website count/digest preservation, namespace boundaries, all M1 and M2.1 RLS-enabled tables, Owner A/B separation, the new restricted settings role, anonymous access denial, strict Auth claim agreement, initial save, immutable revision journal, stale-revision rejection and the known direct-account-deletion blocker.

The second CI step specifically rehearses **future Reserve extraction**:

1. Before creating the extraction target, perform a **rollback-only** rehearsal of dropping Reserve's two domain schemas, public Reserve adapters and custom settings execution role, while checking website account/Arcana persistence. The role-drop step must run before creating the second database because PostgreSQL roles are **cluster-global** on the disposable CI server.
2. Create a second disposable PostgreSQL database with only the required Auth identity surface and two synthetic identity UUIDs.
3. Dump only `reserve` and `reserve_internal` from the simulated shared database, including schema, data, policies, functions, grants, role-bound ownership, settings records and history, and restore to the second database.
4. Check that neither website accounts nor Arcana tables were imported and re-test tenants, roles, settings history, security-function owner and RLS. The separate database shares CI cluster-global roles but has independent tables and schemas.

This is a **database-domain reversibility proof**, not a complete Supabase-to-Supabase production migration. In particular, schema-only `pg_dump` deliberately does not include the two `public.reserve_*` RPC adapters or cluster-global custom roles. A real extraction must recreate and verify those from reviewed migrations, plus handle Supabase Auth identities and account deletion, Storage buckets, Edge Functions, API/schema configuration, secrets, domains, operational services, files, production data ownership/consent and client redirects. The original Reserve project is retained throughout the prototype.

## Safety choices in conversion

- Only the eight allowlisted Reserve `public.*` relations become `reserve.*`; new `public.*` references halt the generator for human review.
- Reserve's `private.*` functions and invitation tables become `reserve_internal.*`. This schema is not exposed by the Data API.
- The original M1.2 `REVOKE CREATE ON SCHEMA public` is retargeted to **`reserve`**, to avoid silently changing the website's privileges.
- M1.2's ownership guard and column-grant cleanup inspect **only** `reserve` and `reserve_internal`, not the website's `public` tables.
- The `reserve` schema is **not** added to Supabase's exposed API schemas. No generic Data API reads/writes become available through these scripts. M2.1 does introduce two deliberately scoped, capability-checked `public.reserve_*` RPC adapters for reading and saving business settings, with no direct table exposure.
- M2.1 remaps all new `private.*` tables, functions and wire types into `reserve_internal.*`. Its cluster-global `veni_settings_executor` role becomes the Sphere-specific `reserve_settings_executor`, with `NOLOGIN`, `NOBYPASSRLS` and `NOINHERIT`. The privileged business-settings writer must remain owned by this role; restoring it under `postgres` would bypass intended RLS.
- The conversion preserves original trigger and RLS logic; its semantic correctness still needs execution against local PostgreSQL, particularly privilege ownership and `SECURITY DEFINER` behavior.
- A standalone Reserve `reserve.users.id` FK still points to the **destination** `auth.users(id)`; cross-project Auth UUID mapping and the website's direct user-deletion Edge Function remain explicit blockers for hosted cutover.

## Definition of done for this preview

- [x] Generator test suites pass locally: ten checks across M1 and M2.1.
- [x] Exact hosted M1 and merged-main M2.1 source digests pass and all four SQL previews generate.
- [ ] Manual diff shows no website `public` grants, schemas, tables or account triggers affected.
- [x] Disposable PostgreSQL 17 CI database applies all four previews; website account/Arcana, tenant separation, bounded settings RPC and constrained execution-role smoke checks pass. This is **not** a Supabase security-advisor pass.
- [ ] Reserve original database tests and website account/Arcana regressions pass.
- [ ] Test tenant identity mapping, account deletion and SSR sign-in are addressed in follow-on work; CI reverse-extraction drill is only a database-domain rehearsal.
- [ ] Ian separately approves any *hosted* Supabase migration/cutover. Not granted by this preview PR.

Canonical design: [Unified Supabase Merger Blueprint v0.1](https://docs.google.com/document/d/1SF0VqLmbFcXHVYVRza5CWTTLc9L_4iiMwR98Mq6Fz08/edit). Sources: [Reserve repo](https://github.com/venipublishing-main/veni-reserve), [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas), and [API security](https://supabase.com/docs/guides/api/securing-your-api).
