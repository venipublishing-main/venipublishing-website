# Veni Account — two-origin shared-Auth browser rehearsal

**17 November 2026. DRAFT test-only proof; not a Website, Reserve or Supabase release.**

## Why this test exists

Ian approved continuing **local, reversible Candidate A work**: Website-owned shared Supabase Auth, with Veni Reserve retaining its independently usable product interface, tenant roles and business data. This is not authorisation for a hosted Auth merge or a change to production sign-in.

A single `auth.users.id` in a shared backend means **one identity**, but it does not mean **one browser login across origins**. The current Website uses static GitHub Pages and persisted browser Supabase sessions; Reserve is a separately deployed SSR application. Local storage, cookies and sign-in state are subject to browser origin boundaries. The alternative OAuth/S256-PKCE client remains a separate, unmerged design experiment (Website PR #3, Reserve PRs #23–#24), not an approved hosted transport.

## New executable evidence

`tests/integration/browser-handoff/shared-auth-two-origin-browser.mjs` launches headless Chromium and two synthetic HTTP origins. It runs **only** with all disposable gates enabled and against the real loopback Supabase GoTrue + PostgREST TARGET stack prepared by the existing integrated rehearsal. No mock Auth is accepted in the CI path.

The browser test verifies:

1. A newly registered `@example.invalid` Website account signs in against real disposable GoTrue, and its session is live.
2. Visiting a separate Reserve-origin page does **not** import the Website's local storage or authenticate the visitor silently.
3. Explicitly signing into the same shared Supabase Auth from Reserve yields exactly the **same immutable Auth UUID**, and the Website's own profile remains RLS-readable to that principal.
4. Forged user-editable `role=owner` / `tenant_id` metadata creates **no** Reserve membership or visible tenant.
5. No code, bearer token, refresh token or password is placed in navigation query/fragment/referrer.
6. Website-origin global logout revokes the other origin's stored session **at the local `veni_account_active_session()` RPC boundary**, even though Reserve's browser storage still holds an old token.
7. Fresh login restores only the principal's identity; it does **not** grant a business membership.

This test uses **synthetic pages**, not the production Veni Website script or actual Reserve SSR UI. It is strong evidence for **browser origin isolation, real local Auth UUID continuity and local RPC revocation** but *not* actual deployed Website↔Reserve SSO or a full E2E UI test. The test verifies the live-session RPC, not that every Reserve endpoint already calls it.

## Remaining red/amber gates

| Gate | Status | Next owner action |
| --- | --- | --- |
| Same Auth principal in two origin-specific browser sessions | Local browser rehearsal planned | Run new disposable CI; inspect logs |
| Seamless Website→Reserve login without asking password a second time | **RED: no secure transfer implemented** | Decide and formally approve a browser transport (e.g. an audited OAuth authorization-code/PKCE route) |
| Actual Website HTML/supabase-js and Reserve SSR browser callback | **RED: synthetic pages only** | Build full local click-through with chosen transport |
| Token/cookie/CSRF/session revocation policy across *all* sensitive endpoints | **AMBER: focused RPC proof only** | Add product-wide fail-closed checks and adversarial tests |
| Reserve Owner/tenant authority and account deletion/retention | **RED hosted** | Separate security, privacy and business approval |
| Hosted provider/account migration, billing, DNS, customer records | **RED: not authorised** | Complete staging and recovery gates, then explicit owner sign-off |

## Runbook and boundaries

- Workflow: `.github/workflows/reserve-integrated-cutover-rehearsal.yml`, after the existing disposable Auth import and independent recovery tests, before stack teardown.
- Node 24, pinned Playwright/Chromium under `tests/integration/browser-handoff/package-lock.json`; no project-level frontend dependency or production script changed.
- Required environment: `VENI_DUAL_AUTH_DISPOSABLE=yes`, `VENI_ATOMIC_RESERVE_REHEARSAL=yes`, `VENI_BROWSER_REAL_AUTH=yes`, `TARGET_API_URL=http://127.0.0.1:<local-stack-port>/`, `TARGET_ANON_KEY` from disposable CLI only. The script rejects hosted URL, HTTPS, non-loopback and out-of-range ports.
- Real Auth account is randomly named with `@example.invalid` and exists only within a Docker stack that the workflow destroys; test writes no hosted Auth, production SQL, DNS, payments, Sports/Performance data or customer records.
- Only safe result if green: **Candidate A remains plausible for common identities, but browser single sign-on is still unbuilt**. Do not describe two password logins as successful SSO, and do not merge any draft PR on this evidence alone.
