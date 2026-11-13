# Reserve discovery — unpublished review

Based on production main `66a82151ad528e64e9dd1c4895afd0c364f9d3b7`, not the older preview repository.
Read-only Pages inspection on 2026-11-13 confirmed legacy publishing from `main:/`
with HTTPS enforced. This feature branch is not the Pages source. The added PR check
has read-only contents permission and no deployment action. Do not merge or publish
without a separate owner instruction.

Homepage: a hero jump link and immediately following discovery card. Platforms: a
Veni Flow software card before the existing platform list. Both prominently link to the
verified standalone non-production Reserve SSR preview, with a separate optional
synthetic Playground link. Real signup/SaaS is explicitly not launched;
no localhost or speculative SaaS origin is in deployable HTML. Existing sections,
account scripts, /kids/, /account/, canonical URLs, CNAME and shared styles are retained.

Run `python -m unittest discover -s tests -v`. For a local-only manual review:
`python -m http.server 5190 --bind 127.0.0.1` from the repository root. Visit `/` and
`/platforms/`; inspect narrow layouts, keyboard focus and the labelled simulation link.
The static server is a local review tool, not a deployment configuration. Tests and
HTTP responses do not establish visual acceptance; browser review remains pending.

The preview link is not a production SaaS launch. Genuine registration and saved
onboarding still require the separately approved shared-authentication gate. Do not transfer account tokens or temporary Playground data.
No parent-site sign-in, analytics, provider or DNS changes are part of this PR.

## Verified preview discovery follow-on — 13 November 2026

Primary destination: https://vf-reserve-app-preview.veni-reserve.workers.dev/
Source: `52f6ffa86b6959ab68dc2577078443cfc7954e4e`. Cloudflare version:
`9a30a871-c061-4532-a758-fe7573f4e728`. Three consistent no-cache release
probes and full public HTTP/security/22-asset hash checks passed. The existing
Playground remains at `c09c24b3ae67190818f313af640693a0fa30aa41`.

This parent-site change remains an unpublished draft PR. Owner browser acceptance
and separate merge/publication authorization are still required. No /kids/,
/account/, DNS, shared authentication or existing site sections changed.
