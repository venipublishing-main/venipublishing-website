# Veni Account → Reserve actor, two-tenant shared Auth compatibility

**17 November 2026 (SAST) · DRAFT · DISPOSABLE / LOCAL-ONLY · OPTION A candidate**

## Verified result

- [GitHub Actions #44104875121](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44104875121) **PASS** on implementation head `2f305b27c38d3d4ded4077c8b42cb9677fbd53fe`.
- **45 bounded assertions** in the new real Auth → Reserve actor contract test; pre-existing shared Website Auth bootstrap, RLS/tenant isolation, Owner audit/receipt/rollback, Website/Arcana preservation, and disposable cleanup also passed.
- [Companion shared Supabase prototype #44104875072](https://github.com/venipublishing-main/venipublishing-website/actions/runs/44104875072) **PASS**.
- Reserve's **unmodified** server actor contract was pinned by immutable SHA `39dc8c073402c7ebdba4f08f423e38a9c027665f` (Reserve draft PR #27); the website's source-to-target migration converters remained pinned to their own immutable source inputs.

## Actual local proof

The fixture used genuine local Supabase GoTrue/PostgREST, one shared Website Auth project, two signed-in synthetic principals (A and B), an outsider with forged Owner metadata, two independently bootstrapped SETUP tenants for A and one for B, and an adapter on the **server/test side** of the contract.

- The adapter verifies the signed-in account through actual GoTrue user identity **and** Reserve's live-session-aware RPC before passing the principal to the actor contract.
- Exact shared Auth UUID continuity is required; neither email nor user_metadata forms an identity binding.
- Trusted test-only SQL reads determine exact Reserve User and Membership rows; the capability check uses the genuine Reserve `list_setup_tenants` RPC under the caller's JWT, which enforces current membership/tenant permission.
- A can select each of A's two tenants only with the explicit target selector and fresh capability check; A cannot select B's tenant and vice versa.
- No selector, missing binding, forged Owner metadata, wrong issuer or unsupported capability fail closed.
- After B's real GoTrue global logout, the previously signed JWT cannot pass the active Reserve session check; A's separate active access remains valid.
- The Website profile query still returns only its owner under Website RLS.

## Exact limitations

This proves **local Option A shared-Auth compatibility**, not a production-ready actor adapter. The test adapter uses privileged direct PostgreSQL reads for server-owned identity/membership lookup; it is not deployed or RLS-scoped as a production Worker adapter. No new public route, product tenant selector UI, transactional write, membership mutation, real browser tenant switch, or refresh token path is connected. The alternative OAuth/federated subject-mapping route (Option B) has separate browser evidence and remains unratified.

Do **not** merge or deploy based on this proof. No hosted Auth, real user/learner/patient data, Sports project, billing, DNS, production Supabase migration, linked identity, or source-project shutdown was touched. All draft PRs remain unmerged.

## Next acceptance gates

1. **Reserve-owned:** independently review and implement a restricted server adapter; verify live issuer/audience/session, exact binding, active membership/capability, and transaction/RLS rechecks; test revocation after a capability change and tenant selection in actual product routes.
2. **Website-owned:** settle central identity linking, cross-Sphere logout/deletion preflight and the shared-Auth versus OAuth/federated architecture decision.
3. **Joint release:** human owner walkthrough, deployable cookie/DNS and provider configuration, staged data migration, independent recovery/rollback, legal retention and written cutover approval.
