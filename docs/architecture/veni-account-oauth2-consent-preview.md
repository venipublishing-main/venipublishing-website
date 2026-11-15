# Veni Account → Sphere OAuth 2.1 consent preview (ADR draft)

**Date:** 15 November 2026 (SAST)  
**Status:** PROPOSED, preview/test only; not enabled in Supabase or deployed  
**Owner:** Veni Publishing / Veni Account  
**Scope:** Website identity provider, then one Sphere at a time; start with Reserve. Performance remains paused.

## Decision proposal

Retain the **Veni Publishing website as the parent identity and account experience**. Allow independently deployed Veni Spheres (Flow → Reserve / Performance; Arcana, etc.) to request this identity via Supabase Auth's **first-party OAuth 2.1/OIDC authorization-code flow with PKCE**. Do not share raw sessions or local-storage tokens between origins. Do not create a custom token exchanger, and do not move the domain or DNS from xneelo. The parent website remains on static GitHub Pages, including the permanent `/kids/` route (no login required there).

Supabase OAuth 2.1 server was in beta and available on all plans without a separate charge when checked on 15 November 2026. This is **not a lifetime pricing guarantee**: it counts toward monthly active users and must be rechecked before activation. Under the $0 constraint, pause if the free tier is inadequate; fall back to the same Supabase user UUID with separate per-Sphere login until a free interoperable solution is validated.

## Flow and trust boundaries

1. A registered **Reserve** client (separately hosted, server-side/confidential when its platform supports secure secret storage) creates a random `state`, `nonce`, and `code_verifier`; it stores the verifier and expected state in a secure, time-limited server-side session/cookie. It sends the browser to the Supabase Auth OAuth authorize endpoint with `client_id`, exact `redirect_uri`, `response_type=code`, scopes, `code_challenge`, and `code_challenge_method=S256`.
2. Supabase validates the client and authorization request and redirects to the parent website **`https://venipublishing.co.za/account/authorize/?authorization_id=...`**, configured as the Supabase Auth Site URL plus authorization path.
3. The static parent page uses only a public/publishable Supabase key. It verifies the logged-in person through `auth.getUser()`. A signed-out person is sent to existing `/account/sign-in/` with a same-origin `next` back to the exact authorization ID.
4. The parent loads `auth.oauth.getAuthorizationDetails(id)` and shows consent **only** for an exact, reviewed client UUID, callback and requested-scope subset in its allowlist. Veni-supplied labels are displayed; SDK-returned strings are never used as HTML. The user explicitly approves or denies. A previously approved grant may return a redirect directly.
5. Call `approveAuthorization(id, {skipBrowserRedirect:true})` / `denyAuthorization(id, {skipBrowserRedirect:true})` so the SDK **cannot navigate before local verification**. The parent checks the returned HTTPS destination against exact allowlisted callback origin/path and a code-or-error response, then redirects.
6. Reserve receives a **short-lived one-use authorization code**, verifies `state` and its session binding, exchanges using PKCE (plus its confidential-client secret only on the server), validates the issuer/audience/nonce/signature, and establishes its own Secure, HttpOnly, SameSite-appropriate app session. It never stores a confidential client secret in browser code or commits it to GitHub.

The resulting account UUID is the same subject across Spheres, but permissions **are not inherited**. The parent controls identity; each Sphere checks its own database entitlement, organization membership and role every time. A Veni Account holder is not thereby a Reserve administrator or Arcana paid subscriber.

## Preview implementation

- `account/authorize/index.html`: parent-branded, accessible consent screen; no navigation link from the live website.
- `assets/js/veni-oauth-contract.mjs`: authorization ID validation; exact client/callback/scope matching; post-decision redirects verified before navigation.
- `assets/js/veni-oauth-consent.mjs`: account check, same-origin login resume, consent/decline, fail-closed rendering.
- `assets/js/veni-oauth-clients.js`: **intentionally empty allowlist** until real clients and their exact callback URIs are approved.
- `tests/veni-oauth-consent.test.mjs`: pure contract + mocked controller security tests; CI stays preview-only.

This PR creates only source files and documentation; **it does not change any hosted Auth switches, JWT keys, client registrations, production tables, DNS, publishing, or existing sign-in**. The separate Reserve database merger remains in draft PR #2 and is not coupled to this UI PR.

## Activation gates — all must pass

1. **Supabase hosted configuration:** confirm OAuth feature and pricing remain $0; configure Site URL and OAuth Authorization Path; explicitly register dedicated Reserve preview/prod clients with **exact** callbacks and correct public/confidential type. No dynamic client registration unless independently authorized.
2. **OIDC keys:** verify asymmetric signing (RS256/ES256) is configured before requesting `openid`; Supabase states HS256 cannot produce OIDC ID tokens. Plan key rotation and JWKS validation.
3. **Hosting and headers:** GitHub Pages cannot be assumed to send the needed `Content-Security-Policy` with `frame-ancestors`, anti-clickjacking, `Cache-Control: no-store`, HSTS, or other endpoint-specific response headers. Before a production consent launch, validate the actual headers and, if necessary, place only the sensitive `/account/authorize/` route behind an approved free hosting/proxy option **without changing parent domain/DNS unexpectedly**. A `<meta>` tag alone is not a substitute for `frame-ancestors` response header.
4. **RLS:** OAuth `openid`/`email`/`profile` scopes describe identity claims; they are **not database authorization**. Review access token `client_id`, memberships, product entitlements, audited reason-for-change workflow and per-Sphere tenant isolation with real Auth tests. Re-run the live-session revocation test; tokens and grants can outlive client-side UI state.
5. **Browser/SDK:** pin Supabase JS to reviewed version; check integrity/dependency policies, browser storage behavior, session expiry, disabled JS, mobile Safari, keyboard navigation, slow network, cancellation, and error recovery. Confirm `skipBrowserRedirect` behaves as tested in the pinned build.
6. **E2E flow:** test unknown client, scope escalation, spoofed redirect, missing/duplicate auth ID, expired request, account swap, repeat consent, deny, revoke grant, token refresh, sign-out across Spheres, email confirmation and password reset with `next`, and rollback.
7. **Reserve client:** implement callback and PKCE exchange in the Reserve repo, verify the actual hosting can securely hold a client secret, and test on an isolated preview deployment before considering production.
8. **Reversibility:** maintain app-specific schemas/roles and a removal drill; a child Sphere can be disabled or extracted without deleting the parent Veni Account, other Spheres or purchased entitlements.
9. **Legal and privacy:** consent copy, data minimization, child-safe `/kids/`, POPIA rights/deletion/retention, auditable access changes, support and incident runbooks approved before customer access.

## Exit / rollback

Leave the client allowlist empty and the OAuth server disabled until the gates pass. If any gate fails, do not serve consent or publish client credentials. Abandon this draft PR or delete only the isolated preview code; keep the existing Veni Account and Reserve draft merge unchanged. The independently usable Sphere login remains a fallback.

## Sources checked (official)

- Supabase [Getting Started with OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- Supabase [OAuth 2.1 Flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- Supabase [Token Security & RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- Supabase Auth JS [OAuth authorization types and `skipBrowserRedirect` semantics](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/types.ts)
