# Veni Account → actual Reserve SSR, disposable browser rehearsal

Date: 17 November 2026 (SAST). **DRAFT / LOCAL-ONLY — NOT A HOSTED RELEASE GATE.**

## Why this test exists

The preceding Website draft PR #19 verified the **actual Website sign-in UI** against a disposable GoTrue instance, but represented Reserve with a deliberately **synthetic second browser origin**. Reserve draft PR #24 independently verified a **real React Router SSR** receiving client, confidential OAuth2 Authorization Code + PKCE, consent *by direct HTTP requests*, and Reserve's tenant denial. Neither proved that an actual human browser could traverse the two real front ends together.

This PR adds the missing browser gate without changing either application’s production files:

1. Actual Reserve `/development/veni-account` → `/auth/veni/start` (SSR, sealed state cookie) → local GoTrue OAuth2.1 authorization with S256 PKCE.
2. Actual Website `/account/authorize/`, which redirects the signed-out user to its real `/account/sign-in/` and resumes the same authorization request after sign-in.
3. Exact client ID, callback URL, scopes and user ID checked on the actual Website consent screen.
4. Real click on **Decline** must not establish a Reserve session.
5. Real click on **Allow connection** must complete the SSR callback; only the common Auth UUID is visible; membership and `/app` remain denied.
6. Real Website navigation sign-out must invalidate the connected Reserve local SSR session.

## Pinned inputs and isolated execution

| Component | Immutable snapshot | What is exercised |
| --- | --- | --- |
| Website sign-in/hub | Website PR #19, stacked into this PR | Checked-in HTML, JavaScript and actual sign-in form |
| Website consent | `bb41ba29314fef53c7d68f5bff644f750b349c25` (draft PR #3) | Checked-in authorization HTML, allow/deny JavaScript and redirect validation |
| Reserve SSR | `40983b9a6f39360a7234ab8a4bb77b2811dd932f` (draft PR #26, including #24) | Real React Router local-only OAuth endpoints, PKCE exchange, RLS status and protected business route |
| Supabase Auth / PostgreSQL | Reserve-pinned local CLI / project | Fresh disposable Docker stack on `127.0.0.1:54321`, no hosted credentials |
| Chromium browser | Playwright 1.56.1 | Real user navigation, form completion, consent clicks and session checks |

The Website consent draft intentionally rejects `http:` Supabase configuration and non-`sb_publishable_` keys, and has an empty approved-client list. The rehearsal **does not relax these checks in production**. Instead, a bound-to-loopback, ephemeral self-signed `https://127.0.0.1:54443` facade forwards only to disposable local GoTrue, while the isolated local Website static server supplies a fake `sb_publishable_` test key and one test-only client allowlist. The browser intercepts the public SDK CDN URL and supplies the pinned local browser bundle; all other external requests are aborted.

Synthetic user credentials, OAuth client secrets, TLS certificate, and Reserve `.dev.vars` are created only for the CI run and removed in its `finally` block. The workflow separately tears down the precise local Docker stack even if assertions fail. The two 127.0.0.1 origins use different ports: browser storage is origin-scoped, but **local cookies are not port-scoped**, and this test does not certify production cross-subdomain cookie design.

## Gate matrix

| Evidence | Status | Scope |
| --- | --- | --- |
| Actual Website sign-in + profile + logout in Chromium | **GREEN**, prior PR #19 | Browser against a disposable shared local Auth, Reserve synthetic |
| Real Reserve SSR OAuth2/PKCE and tenant-denial HTTP | **GREEN**, prior Reserve PR #24 | Programmatic local GoTrue; no Website UI |
| Actual Website consent + actual Reserve SSR in Chromium | **GREEN** — [run #44069844635](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44069844635) | 41 bounded local assertions, exact Website/Reserve browser journey |
| Hosted OAuth client registration and callback | **RED / not authorized** | No real client has been enabled |
| Production cookie topology, redirect contract, logout semantics and account migration | **RED / not authorized** | Need architecture approval and separate security review |
| Live Reserve data, Sports backend and any billing/production changes | **UNTOUCHED** | This test makes no changes to them |

CI workflow: `.github/workflows/veni-account-reserve-ssr-browser-rehearsal.yml`.

### Observed results — first execution, 17 November 2026

- [**PASS** GitHub Actions run #44069844635](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44069844635), implementation SHA `7b986e278b08316a621f1e39c79f923a0076c571`, job `real-reserve-ssr-browser` conclusion `success`.
- Logs show **41 assertions** and four explicit milestones: real Website sign-in+consent; actual browser Decline; actual browser Allow with Reserve SSR PKCE callback and locked tenant route; Website sign-out revoking Reserve SSR live session.
- Checked-out source snapshots were pinned, and the runner's teardown of its disposable local Docker stack completed successfully.
- This evidence is limited to local development with an ephemeral OAuth client, self-signed TLS loopback facade and test-only allowlist. It does not register a hosted OAuth client, prove live DNS/subdomain cookie semantics, grant a Reserve role, or move data.

## Decision boundaries

Candidate A (shared Auth UUID with explicit separate sign-ins) is not the same as Candidate B (parent consent and a defined OAuth2 receiving-client transport). This new test experiments with **Candidate B** only, on disposable fixtures. Even a green browser run is **not** approval to enable it on the public Website, activate the Sports project, claim seamless production SSO, merge draft PRs, or cut over an existing Reserve identity or business record.

Next decision if green: review the real browser consent UX, cookie/domain/session architecture, and Reserve membership grant contract before approving any hosted pilot. If red: preserve the failure as evidence and fix the narrow integration seam without broadening hosted permissions.
