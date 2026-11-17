# Veni Account ↔ Reserve SSR — adversarial browser security gate

**17 November 2026 (SAST) · DRAFT · DISPOSABLE / LOCAL-ONLY**

## Proven result

[GitHub Actions run #44083505590](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44083505590) passed on implementation SHA `551faafafcc74236009052b33f0b135587e6757d`: **57 bounded assertions** in real Chromium, with actual Website sign-in and OAuth consent UI, actual Reserve React Router SSR receiving client, genuine locally launched Supabase GoTrue/PostgreSQL, and fictional user/client. This extends [Website draft PR #20](https://github.com/venipublishing-main/venipublishing-website/pull/20), which had passed 41 assertions.

## Negative-case acceptance ledger

| Probe | Observed expected boundary |
| --- | --- |
| Forged OAuth `state` with original sealed transaction cookie | Reserve SSR rejects callback (HTTP 400); no connected session |
| Duplicate callback `state` values | Reserve SSR rejects parameter ambiguity (HTTP 400) |
| Duplicate `next` arguments at Reserve OAuth start | Reserve SSR rejects request (HTTP 400) |
| External `next` URL on Reserve OAuth start | Initial destination remains local GoTrue, not an outbound redirect; safe-next normalization remains in the reviewed Reserve source |
| Repeat real OAuth code after Chromium completed its original PKCE exchange, with original state and transaction cookie restored | Reserve SSR rejects one-time-code replay (HTTP 503); no new session |
| Mutate authenticated encryption on local session cookie | Reserve SSR displays no verified session |
| Access connected cookie through browser JavaScript | HttpOnly cookie hidden; session expiry capped to five minutes |
| Open Reserve and Website in an independent Chromium context | No inherited Reserve session or Website sign-in |

The existing positive flow still passes in the same run: Reserve SSR → Website sign-in → consent metadata → Decline → retry → Allow → verified common Auth UUID, no Reserve tenant/product permission, protected `/app` blocked, and real Website global sign-out revoking the SSR live session.

## Execution boundaries

- GitHub-hosted Linux Node24 + pinned local Supabase CLI and Playwright Chromium; exact loopback origins only.
- Source snapshots of Reserve and Website OAuth consent remain pinned as in PR #20. The test creates a disposable confidential OAuth client, fictional adult, ephemeral TLS facade for the Website's strict HTTPS configuration guard, test-only approved-client fixture, and temporary Reserve secrets. External browser requests are aborted.
- No hosted Supabase reads or writes, authentic user data, tenant import, Sports activation, DNS, deployment, billing, production registration, or merge. An existing authenticated browser context is not assumed to be interchangeable with another.
- This **does not prove** public subdomain cookie isolation, hosted MFA/refresh handling, tenant selection, every supported identity provider, account migration/linking, full deletion lifecycle, or a human manual walkthrough.

## Release-gate consequence

VA-04 may now record **GREEN: disposable real Website↔real Reserve consent plus adversarial SSR browser tests**. **RED remains** for production hostname/cookie/SameSite/CSRF security, real tenant role assignment, refresh and expiry recovery, manual acceptance, hosted staging, identity migration choice, and written cutover authority. Identity migration Route A vs Route B is a separate question from OAuth session transport.

Draft PR: https://github.com/venipublishing-main/venipublishing-website/pull/21
