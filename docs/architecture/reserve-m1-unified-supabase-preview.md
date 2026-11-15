# Reserve-first shared Supabase prototype — M1 preview

**Status: LOCAL-ONLY, unmerged proposal. No live database changes.**  
Date: 15 November 2026. Owner: Veni Publishing.

## Product hierarchy

The **Veni Publishing website is the parent portal**, with the single Veni Account Layer serving all Spheres. Veni Flow contains Reserve and Performance; Arcana and other Spheres are siblings of Flow. The Supabase project is shared backend infrastructure, **not** the visible parent of the website. This implements the ratified DEC-013 interface direction without collapsing independent repos or deployments.

## Aim and boundaries

Destination eventually: existing Veni Publishing Supabase `droslqfcazwkwvqlbtsq`; do not create a fourth project or pay for a new plan. Source: Reserve staging `opjgaepryqwmsohtajja`. Performance `tdiiuqbagclwknlmdlfb` remains paused and excluded.

The generator is an **offline preflight** of the three Reserve migrations that were actually deployed to staging as of the audit. It produces reviewable SQL previews for `reserve.*` and `reserve_internal.*`, preserving the existing website's `public.*` account/Arcana records. It neither connects to Supabase nor runs SQL.

It intentionally excludes Reserve's later main business-settings migration and draft PRs #20 and #22. Those must be pinned and integrated in order, in coordination with ongoing Reserve development, before any complete migration can proceed.

## Repeatable developer procedure

1. Check out `venipublishing-main/venipublishing-website` and `venipublishing-main/veni-reserve` in adjacent folders. Verify the Reserve checkout contains the pinned hosted M1 SQL exactly; the generator validates each Git blob digest and fails on drift.
2. In the **website** repository, run `node --test tests/merge-reserve-m1.test.mjs` (only built-in Node libraries; no packages or credentials).
3. Run `node scripts/merge-reserve-m1.mjs --reserve-root ../veni-reserve --out-dir ../reserve-merger-preview` to produce three `preview-*.sql` files **outside** `supabase/migrations`. The output directory must not already contain those filenames, to avoid accidental overwrite.
4. Read the generated SQL diff, especially RLS policies, helpers and privileges. Run in a disposable **local** PostgreSQL/Supabase integration stack against a faithful copy of the website schema. The generator's static tests are **not database execution tests**.
5. Confirm `public.profiles`, `public.products`, `public.entitlements` and all `public.arcana_*` tables are unchanged. Run tenant A/B cross-read/write-denial, authenticated/anonymous/revoked-access checks, owner/audit invariants, and the original Reserve pgTAP suite. Check `auth.users` linkage and deletion behavior.
6. Only once the full pipeline is green, use the installed **Supabase CLI's current `--help`** to create a real versioned migration via `supabase migration new ...` and compare its contents against the reviewed preview. CLI v3 changed defaults in November 2026. Keep this initial PR draft until verified.

## Safety choices in conversion

- Only the eight allowlisted Reserve `public.*` relations become `reserve.*`; new `public.*` references halt the generator for human review.
- Reserve's `private.*` functions and invitation tables become `reserve_internal.*`. This schema is not exposed by the Data API.
- The original M1.2 `REVOKE CREATE ON SCHEMA public` is retargeted to **`reserve`**, to avoid silently changing the website's privileges.
- M1.2's ownership guard and column-grant cleanup inspect **only** `reserve` and `reserve_internal`, not the website's `public` tables.
- The `reserve` schema is **not** added to Supabase's exposed API schemas. No new generic Data API reads/writes become available through these scripts. A narrow, reviewed `public.reserve_*` RPC adapter is a later stage.
- The conversion preserves original trigger and RLS logic; its semantic correctness still needs execution against local PostgreSQL, particularly privilege ownership and `SECURITY DEFINER` behavior.
- A standalone Reserve `reserve.users.id` FK still points to the **destination** `auth.users(id)`; cross-project Auth UUID mapping and the website's direct user-deletion Edge Function remain explicit blockers for hosted cutover.

## Definition of done for this preview

- [ ] Generator test suite passes locally.
- [ ] Exact hosted M1 source digests pass and all three SQL previews generate.
- [ ] Manual diff shows no website `public` grants, schemas, tables or account triggers affected.
- [ ] Disposable local database applies all previews in order, with RLS/security advisors clean.
- [ ] Reserve original database tests and website account/Arcana regressions pass.
- [ ] Test tenant identity mapping, account deletion, reverse extraction and SSR sign-in are addressed in follow-on work.
- [ ] Ian separately approves any *hosted* Supabase migration/cutover. Not granted by this preview PR.

Canonical design: [Unified Supabase Merger Blueprint v0.1](https://docs.google.com/document/d/1SF0VqLmbFcXHVYVRza5CWTTLc9L_4iiMwR98Mq6Fz08/edit). Sources: [Reserve repo](https://github.com/venipublishing-main/veni-reserve), [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas), and [API security](https://supabase.com/docs/guides/api/securing-your-api).
