# Veni Account ↔ Reserve SSR — browser-session recovery evidence

**17 November 2026 (SAST) · DRAFT · DISPOSABLE / LOCAL-ONLY**

## Verified run

- [GitHub Actions #44094724971](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44094724971) **PASS** on `2b6f83eec88f2e3e13539588d465018c91c6086e`: **66 bounded real Website↔Reserve OAuth browser assertions** plus **25 separate HTTPS cookie/CSRF policy assertions**.
- Companion [atomic Auth/business rehearsal #44094724892](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44094724892) and [shared Supabase prototype #44094724976](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44094724976) also **PASS**.
- No hosted services, real identities, production business records or Sports project were changed.

## Additional browser loss/recovery acceptance

| Step | Observed result |
| --- | --- |
| Delete only Reserve's connected browser cookie | Browser holds no Reserve session |
| Visit real Reserve SSR connected-account screen | Real SSR displays unverified state and offers new connection |
| Visit real Website account hub independently | Existing Website Auth session remains signed in |
| Restart actual Reserve OAuth S256 PKCE | Website authorization resumes without a second password |
| Repeat same client and scopes | Existing prior consent was reused in the observed Chromium run; test also supports a fresh consent screen if required, but that alternate branch was not observed |
| Track actual Reserve callback | A new one-time authorization-code callback occurred |
| Examine new Reserve session | Distinct sealed HttpOnly SameSite cookie; shared verified Auth UUID unchanged |
| Visit Reserve business app | Still denied without actual Reserve tenant membership |
| Trigger Website global sign-out | Previously reconnected Reserve session is no longer verified |

Original adversarial proofs remain present: forged/duplicate state, open redirects, redeemed-code replay, sealed-cookie tampering and cross-browser isolation.

## Carefully limited meaning

This is a **client-side cookie eviction simulation**, not five-minute server-session TTL expiration or refresh-token rotation. The actual Reserve tenant selector, role grants, account linking, provider outage recovery, OAuth consent-required repeat branch, supported identity-provider variants and hosted DNS/cookie deployment are still **unproven**. A shared Auth UUID never grants Reserve Owner, staff or any other product capability.

Synthetic GoTrue/PostgreSQL, test-only OAuth client, fictional account, pinned unactivated Website consent UI and pinned real Reserve SSR receiver; no live data or deployment. PRs remain draft and unmerged.

## Next handoff

- **Reserve-owned:** tenant selector and actor contract (two or more synthetic tenants, revoked membership, wrong tenant, per-capability freshness), actual product route wiring and corresponding local RLS integration.
- **Website-owned:** centrally governed identity-linking/migration decision, account deletion preflight, refresh/session expiry and cross-product logout semantics, owner manual walkthrough.
- **Release authority:** explicit architecture approval, staging proof, rollback plan and written production cutover consent remain necessary.
