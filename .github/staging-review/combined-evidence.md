# Combined staging evidence · 20–21 November 2026

The accepted local Website revision is `c42a9882241545a6feb99083449b94ead4bc5ee4`. The shared-replay CI job runs the public database and entitlement portion against disposable services. Discovery and Reserve disconnection are separate checks. The Performance application, live product-token comparisons and rollback results below come from the accepted local rehearsal.

## Public replay

Inputs are Website SQL `065a31be962533576a52016dc9ac8bee6535e375`, Arcana `ae1c4929ce8d8aaa954eacfe9b4494bfb2924301` and Reserve `756e25a8919eae41964ece4e836388fa0dbd3a8a`. The job uses Node 24, Reserve’s locked CLI (2.122.0), PostgreSQL 17 and GoTrue v2.198.0. The exact commands and loopback configuration are committed with the job. [CI workflow](../workflows/shared-release-replay.yml) · [Reviewed ledger hashes](manifest.json)

The job verifies the fixture bootstrap and sixteen canonical file hashes, starts from the twelve historical fixture files, signs in a synthetic Website user and Reserve client, and applies the five forward files. It checks existing-session survival, direct/delegated boundaries, two businesses under one owner, both grant bases, expiry, future start, revocation and private privileges. It compares all seventeen applied files against the pinned inputs and counts the disposable ledger entries.

## Restricted-source reproduction

An authorized reviewer needs the Performance checkout at `e4f42b6ab6dd94effa94125ccb4e560d846991ca`, the three public revisions above and a fresh, unlinked Docker fixture. Use synthetic identities and loopback ports 57420–57431. The local runs used the fixture IDs `veni_shared_release_1120_exact` for the exact ledger and `veni_shared_release_1120_accepted` for the hook-enabled matrix. The first integration replay used a Windows working copy with CRLF in the onboarding file. The subsequent exact replay used the committed Git bytes. All five proposed hashes are unchanged.

1. Use the public workflow’s fixture and ledger commands. Before applying the forward files, run Performance’s `python migration/sibling_regression.py <website-checkout> <cli-js>` against the fresh historical baseline. Substitute the chosen dedicated fixture ID for the fixed disposable name in the test helpers. Verify the two historical suites, then run the Website shared-release replay and local security advisors.
2. On the separate combined fixture with the five files applied, execute the pinned `deployment/classify-reserve.sql` against the synthetic database. Stop that local stack preserving its volume, enable its local custom access token hook at `pg-functions://postgres/veni_account_routing/access_token`, and restart the same fixture. Use the local CLI’s `status` inside the test programs. Keep private source, raw logs and generated credentials in operator custody.
3. From the Performance fixture run `python migration/converted_qa.py --role`, `node tests/local-oauth.mjs <cli-js> --role`, then `node tests/isolation-matrix.mjs <cli-js> --shared-release`. The archived runner inputs for these tests, the service canary and the SQL fixture helper were compared to the pinned source after substituting only the fixture ID and normalizing line endings. Each comparison matched.

## Local results and evidence fingerprints

The hashes identify the original local log bytes for independent comparison in restricted custody. A new run generates new fixture data and timings, so compare assertions across runs.

| Evidence | Observed result | SHA-256 of original log |
|---|---|---|
| Exact forward replay | Five additions preserved Website and Reserve sessions. Grant decisions stayed within the exact business and validity window. | `36eac8f71d2166435b9184ee6cdc864fd4f818cb12d2c3f722051882cec082a7` |
| Historical sibling tests | Website identity and separate Reserve catalogue passed. Private theme, revision, role, RLS and Website/Arcana checks passed. | `512b3e578df2cd23d4f28ae6eea00d971bb6d64d50bf648426352166748c3e4d` |
| Performance SQL | Five namespaced suites passed for operations, scoring and invitations, including authenticated-role checks. | `5605f60b6dfb5b600203bae935bc9c0090f6e2bd2058b5671450080d267ab5d4` |
| Performance OAuth | Consent cancellation produced no grant or cookie. Sign-in, expiry, explicit owner creation, two-session revocation, surviving Website access and fresh consent passed. | `8094b7ee526f760bf6fda0a6ab5d5de8abe9b479c54d5edf513ad93fe52530b5` |
| Cross-product matrix | Direct, single-product, dual-product and unentitled identities, organization isolation, REST/RPC/view boundaries, private Storage/Realtime and role on refresh passed. Hook failure stopped issuance. Withdrawal preserved sibling access and organization data. Retirement left **3 sessions / 2 active consents**. Per-user grant revocation produced **0 / 0**. | `03d13cc52e44011edd8409161556b42296d47e507b788b06059bdbb4fe9e8d01` |
| Security advisors | Zero warning/error findings on the exact replay. | `d77969b6666a7639c658f64a08cf511479aff115d4749e0969eee20692a754c8` |

The accepted application regression counts were 31 Website Node tests, 3 Website Python tests, 521 Reserve tests and 28 Performance tests. Both packaged staging Worker builds and Wrangler dry-runs passed. Production account deletion was never used as a canary.
