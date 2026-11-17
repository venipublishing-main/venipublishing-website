# Veni Account — actual Website UI / second-origin browser gate

**Date:** 17 November 2026 (SAST)  
**Status:** PASS in genuine disposable GitHub Actions Chromium and GoTrue/PostgREST; DRAFT / local-only evidence.  
**Scope:** Website Account Layer's Candidate A, a single Website-owned Supabase Auth principal with separate Sphere permissions. No hosted migration approval or SSO transport decision.

## What is genuinely exercised

1. GitHub Actions checks out the **actual** `account/sign-in/index.html`, `account/index.html`, `assets/js/veni-account.js` and `assets/js/site.js` and serves those files unmodified from a disposable loopback Website origin. Styles, manifest and branding are read from the same checkout.
2. Its checked-in `assets/js/supabase-config.js` is **never served**. The test origin replaces it with the **public anon key + URL of the genuine disposable local GoTrue/PostgREST target**. It rejects non-loopback API hosts/ports and requires all three disposable-run opt-in variables.
3. The production HTML's unversioned CDN script request is intercepted before network delivery and fulfilled with an `@supabase/supabase-js` **exact 2.119.0**, npm-locked UMD bundle. Other outbound browser requests are blocked at the request-routing boundary.
4. A fictional adult test account signs up on local Auth only. Playwright fills and submits the **real Website sign-in form**, checks the actual success redirect to the account hub, account signed-in view, authenticated `auth.getUser()` UUID, profile RLS and browser-local session.
5. A malicious cross-origin `next=` on the sign-in URL cannot redirect the actual Website UI off its origin. No bearer token or password is placed in the navigation URL.
6. The browser then visits a **synthetic second HTTP origin** representing only Reserve's browser storage boundary. It has no Website session or stored bearer token. A **second explicit** password login authenticates the same UUID. The genuine local `reserve.tenants` RLS query stays empty despite spoofed `user_metadata.role=owner` and `tenant_id` on the Auth account.
7. The browser returns to the actual Website hub, selects the **real navigation Sign out** action, and checks that local Website session storage clears. The cached synthetic Reserve bearer fails the genuine disposable `public.veni_account_active_session()` RPC after Website global logout.

The browser script is `tests/integration/browser-handoff/real-website-signin-browser.mjs`; the underlying SQL prototypes and local-stack restore are exercised separately in the existing integrated workflow.

## Acceptance / evidence matrix

| Boundary | Required assertion | Status |
|---|---|---|
| Actual Website form → real disposable Auth | UUID, signed-in hub, profile RLS | **PASS — Chromium** |
| Safe Website post-login routing | External `next=` rejected; no credentials in URL | **PASS — Chromium** |
| Browser origin separation | Reserve synthetic page has no Website storage | **PASS — Chromium** |
| Same account, separate business authority | Same UUID; forged Owner and tenant membership denied | **PASS — real Reserve RLS** |
| Real Website navigation logout | Cached Reserve JWT rejected at *tested* session RPC | **PASS — real GoTrue/RPC** |
| Actual Reserve SSR callback and browser UI | Independent production implementation tested | **NOT TESTED** |
| Seamless one-click Website → Reserve SSO | Secure code/PKCE/handoff agreed and tested | **NOT IMPLEMENTED / RED** |
| Hosted Supabase, production data, Sports activation | Any mutation made | **NONE — prohibited** |

## Interpretation and go/no-go

- A green result adds evidence for the **actual Website login UI**, not for the entire cross-platform login journey.
- The synthetic Reserve page is intentionally *not* a substitute for Reserve's Next.js SSR flows, callback, tenants, business records, or payment entitlements. Those remain Reserve-owned integration tasks.
- Browser storage isolation is expected; shared Supabase Auth UUID **does not automatically implement cross-origin SSO**. A secure transfer design still requires an explicit architecture decision, CSRF/state protection, one-time audience-scoped exchange and separate SSR/RLS test coverage.
- The local RPC is the revocation check under test. No inference of production-wide revocation coverage, cross-tab instant logout, account deletion safety, or billing readiness is warranted.
- **Continue local-only. Do not merge, deploy, activate Sports, migrate hosted user records, remove the old Supabase project, or enable real cross-origin redirects from this result alone.**

## Verification

- **PASS:** [Integrated source→Website target, logical backup/restore, actual Website sign-in and two-origin Chromium rehearsal — Actions #44065838206](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44065838206).
- **PASS:** [Companion shared Supabase local Postgres prototype — Actions #44065838300](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44065838300).
- Both succeeded on initial draft head `84171eb93f950d590f68f6da120c56623a20a4fa`, 17 November 2026. The integrated job log contains five explicit `PASS` lines and `WEBSITE UI GATE: real sign-in + logout PASS against disposable Auth.`
- Documentation-only follow-up commits must not be mistaken for new hosted evidence. Real Reserve SSR/handoff and the production release decision remain red.
