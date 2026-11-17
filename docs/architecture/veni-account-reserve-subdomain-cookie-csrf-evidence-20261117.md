# Veni Account ↔ Reserve — HTTPS sibling-domain cookie/CSRF policy evidence

**17 November 2026 (SAST) · DRAFT · DISPOSABLE / LOCAL-ONLY**

## Verified outcome

- [GitHub Actions #44091415732](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44091415732) **PASS** on implementation commit `72907be87f9325b780f7c8aac295cbc42d198e61`.
- **25 real-Chromium HTTPS subdomain-policy assertions passed**, plus the **57 actual Website↔Reserve OAuth/PKCE SSR assertions** in the same workflow.
- Two companion workflows on that commit passed: [atomic Auth/business cutover rehearsal #44091415557](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44091415557) and [shared Supabase prototype #44091415548](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44091415548).
- Disposable GoTrue/PostgreSQL, temporary TLS materials, synthetic identity/client, and browser sessions were cleaned up. No real data or hosted endpoint was accessed.

## Policy proven in the synthetic HTTPS harness

| Probe | Bounded observation |
| --- | --- |
| `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, five-minute maximum | Chromium accepts the proposed protected Reserve session cookie and hides it from page JavaScript |
| `account.veni.test` versus `reserve.veni.test` | Host-only Reserve cookie is not received by the Website sibling |
| Cookie-tossing attempts from sibling Website | Invalid Domain/Path/insecure variants cannot replace the `__Host-` Reserve cookie; an unprefixed Domain cookie can cross siblings |
| Sibling-origin HTML form POST | Chromium sends the Lax Reserve cookie and marks the request same-site; exact Origin + CSRF checks reject its mutation |
| True external `attacker.test` POST | The explicit Lax session cookie is omitted; cross-site mutation is rejected |
| External top-level GET navigation | Lax cookie can accompany navigation, so OAuth callback state remains necessary; GET cannot mutate |
| Legitimate Reserve HTML form POST | Correct HTTPS origin plus one valid CSRF token permits only the synthetic mock write; a missing token fails |
| One-second synthetic expiry and fresh browser context | Cookie expires; independent context inherits no Reserve session |
| Browser network guard | No requests leave the three synthetic loopback-mapped HTTPS origins |

## Root cause addressed during the run

The initial synthetic server returned `Referrer-Policy: no-referrer` on its HTML form documents. For navigation-mode form POSTs, that makes browsers send an opaque `Origin: null`, **even for the legitimate same-origin form**. The policy gate correctly failed closed, but the test incorrectly expected an exact origin.

Only HTML form responses in the disposable test harness now use `Referrer-Policy: strict-origin`, retaining the exact HTTPS origin while withholding paths and query strings. The server still requires an exact Reserve Origin, a protected session cookie, and a matching form CSRF token for mutation. The previously failing test has passed with those stronger exact-origin assertions. Technical basis: [MDN Referrer-Policy and Origin header behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header).

## Hard boundaries

This **does not certify** the production Reserve app's cookie issuance, actual product mutation routes, hosted domain/DNS, session refresh, tenant selection, account linking, MFA, OAuth activation, billing, identity migration or user deletion. It is a browser policy contract for the eventual deployment, not a deployed fix. Reserve tenant grants and product data remain strictly product-owned.

All PRs are draft/unmerged; no hosted Supabase, Sports project, real identities, migration, booking records or production deployment changed.

## Next release gates

1. Real Reserve tenant selection/membership tests with at least two isolated synthetic tenants and explicit deny cases; Reserve owns business authority.
2. Expired/invalid SSR session recovery and independent versus global sign-out, including interrupted OAuth and safe re-authentication.
3. Existing Reserve principal linking/migration route decision, manual owner walkthrough, hosted-staging security review and explicit deployment/cutover approval.
