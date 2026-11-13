# Reserve discovery — unpublished review

Based on production main `66a82151ad528e64e9dd1c4895afd0c364f9d3b7`, not the older preview repository.
Read-only Pages inspection on 2026-11-13 confirmed legacy publishing from `main:/`
with HTTPS enforced. This feature branch is not the Pages source. The added PR check
has read-only contents permission and no deployment action. Do not merge or publish
without a separate owner instruction.

Homepage: a hero jump link and immediately following discovery card. Platforms: a
Veni Flow software card before the existing platform list. Both link only to the
already-published synthetic Playground. Real signup/SaaS is explicitly not launched;
no localhost or speculative SaaS origin is in deployable HTML. Existing sections,
account scripts, /kids/, /account/, canonical URLs, CNAME and shared styles are retained.

Run `python -m unittest discover -s tests -v`. For a local-only manual review:
`python -m http.server 5190 --bind 127.0.0.1` from the repository root. Visit `/` and
`/platforms/`; inspect narrow layouts, keyboard focus and the labelled simulation link.
The static server is a local review tool, not a deployment configuration. Tests and
HTTP responses do not establish visual acceptance; browser review remains pending.

Future real SaaS linking requires an approved standalone HTTPS SSR origin and an
operational auth/onboarding gate. Replace the pending copy with an ordinary direct
product link only then. Do not transfer account tokens or temporary Playground data.
No parent-site sign-in, analytics, provider or DNS changes are part of this PR.
