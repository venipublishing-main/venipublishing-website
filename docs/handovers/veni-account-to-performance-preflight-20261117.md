# Veni Account → Veni Performance integration preflight v0.1

**Status:** DRAFT / DOCS-ONLY, 17 November 2026. **No Sports project activation, hosted migration, account link, PR merge, deployment or billing approval.**

## Authority, sequence and verified limits

1. Ratified platform rule **DEC-013**: one Veni Account identity and central entitlements, independent Sphere repositories/deployments, Sphere-owned domain state; Veni Flow contains **Reserve** and **Performance** as siblings. Website is the umbrella, not a sports management application. A central entitlement allows product access; it cannot grant organisation membership, coaching permissions or athlete access.
2. The *draft* Unified Supabase Merger Blueprint v0.1 explicitly defers Performance until **Reserve's shared-backend migration passes required gates**, Reserve's legacy project is safely releasable and a free project slot exists. This is a sequencing rule for hosted migration, not a prohibition on local design and testing. The alternative OAuth/SSR federation candidate is likewise unratified. Reserve's 17 Nov independent audit [draft PR #26](https://github.com/venipublishing-main/veni-reserve/pull/26) estimates **35% overall integration readiness (production 0%)**; its 65/65 local tests do NOT represent an approved or partially deployed hosted migration. Direct *synthetic* GoTrue restart did pass Website [draft PR #7](https://github.com/venipublishing-main/venipublishing-website/pull/7), but hosted backup/restore remains open.
3. **Performance v0.8 handover evidence** (from the prior Sports project, not independently rerun in this audit): `sports-core-dev` / `tdiiuqbagclwknlmdlfb`, paused; **11 migrations, 20 RLS-protected tables, 28 tests**, own Org/Role/Invitation/Delegated Permission/Audit backend. No real Auth users or athlete records were reported at the 15 Nov audit. Direct current DB inspection and live test execution are **NOT VERIFIED**; source repository/11 migration files have not been located under connected `venipublishing-main` GitHub or Veni Flow Drive as of this preflight. No code migration can be accepted without them.
4. The old Sports `public.profiles(user_id)` is **incompatible** with the Website's existing `public.profiles(id)`. Never replay Sports `public` migrations into shared `public`. A future local-first import candidate would isolate `performance.*` / `performance_internal.*`, preserve Website accounts, and provide narrowly scoped compatibility adapters. Those schemas are **reserved, not created**.
5. Veni Performance is distinct from Reserve, both standalone in navigation, onboarding and business operation even when linked to the same Account. Preserve historical data, independent extraction and $0-first development.

## Ownership and account boundary

| Concern | Veni Account / Website authority | Veni Performance authority | Hard rule |
| --- | --- | --- | --- |
| Identity | Stable primary account, authentication, session/assurance | Verify mapped person; create local projection only where necessary | Never match users or grant rights from email alone |
| Platform entitlement | Eligibility to access Performance or a paid feature | Revalidate entitlement at protected product entry/service | Entitlement is not organisation membership |
| Organisation | Discover/list membership without exposing private data | Create/manage school or club organisation, owner assignment, branded settings | All organisation data tenant-scoped |
| Permissions | No sport/coach privileges in Account JWT/profile | Owner/Admin → Head of Sport → Coach; assign/revoke delegated rights | Verify server-side each operation; log changes |
| Players/minors | Identity/lifecycle and global privacy interface | Player self-registration, team links, attendance, historical performance, safeguarding | Explicit guardian/consent design before minor data |
| Financial/billing | Central billing→entitlement translation | Organisation-specific weights/formulas and event audit | Billing grant never bypasses athlete-record permissions |
| Closure/export | Shared account closure, privacy/retention orchestration | Organisation ownership succession, athlete-data export and controlled retention | No blind `auth.users` cascade or audit destruction |

## Preserve existing Performance product decisions

- Multi-organisation SaaS for schools and clubs; approximate design target of twenty coaches per organisation, with one owner/admin and hierarchical sport/coach assignments. Real scale limits require measurement, not a baked-in user cap.
- Coaches invite by QR/link; players self-register with an email/profile; coach confirms attendance and may override with a recorded reason. No silent override and no uncontrolled athlete cross-organisation visibility.
- Shared calculation/formula templates with **organisation-specific weighting/threshold overrides**. Template version updates must not corrupt an organisation's historic grades or recompute old results silently.
- Organisation-specific badge and colour identity; PBHS red/white/green is an example, not a global default.
- Hierarchical permission delegation is revocable by an authorised higher-tier role; change-then-reason modal offers **Accept/Cancel**, with final commit only after server authorization and immutable audit. A missing/blank reason cancels sensitive changes.
- Standalone Performance login and use must coexist with an optional seamless Veni Account return-to-product. Define the offline/identity-provider-outage policy explicitly rather than minting an unapproved second identity authority.
- Performance owns its application data and schema contract independently of Reserve. No Reserve table/tenant/membership reuse just because both belong to Veni Flow.

## Independent test checklist for the Sports development team

**G — green: local-only work now**

| ID | Test / deliverable | Minimum independently reproducible evidence | State |
| --- | --- | --- | --- |
| VP-G01 | Recover source provenance | Exact 11 migration files, 20-table inventory, repo/worktree, schema fingerprint, test runner, environment manifest without credentials | **BLOCKED: source location not verified** |
| VP-G02 | Re-run existing authorization suite | Actual disposable Postgres/Auth RLS tests with separate Orgs, inactive/revoked memberships and forbidden cross-tenant reads/writes; no pass claims from prior summary | **PENDING SOURCE** |
| VP-G03 | Organisation/bootstrap continuity | Synthetic Owner creates Org; active Owner and audit; idempotent retry; no ghost org or duplicate membership; no account inferred from matching email | **READY TO TEST LOCALLY** |
| VP-G04 | Delegated rights | Admin grants/revokes Head and Coach capabilities; after mutation requires reason/accept; cancel leaves no write; stale JWT and direct API cannot bypass current permission | **READY TO TEST LOCALLY** |
| VP-G05 | Player flow | QR/link integrity/expiry, duplicate invites, email verification, consent/safeguarding before storing minors, coach approval, player attached only to correct Org/team | **DESIGN + LOCAL TEST** |
| VP-G06 | Attendance/override | Coach confirms; controlled override reason; immutable who/when/old/new; unauthorised coach and role-revoked actor denied | **READY TO TEST LOCALLY** |
| VP-G07 | Rating/formula versioning | Per-Org weighted mappings, consistent shared template revisions, historical immutable snapshots and conflict/rollback behavior | **DESIGN + LOCAL TEST** |
| VP-G08 | Standalone user experience | School branding, head-of-sport/coach/player route access, independent deep links, no cross-product portfolio in workflows; mobile/keyboard/manual review | **DESIGN/REVIEW** |
| VP-G09 | Source portability | Synthetic Org+player export/import, RLS, media and log preservation, schema-level extraction to fresh isolated DB; independent rollback | **DESIGN + LOCAL TEST** |

**A — amber: joint Website/Performance identity tests after architecture decision**

| ID | Required case | Pass condition | Gate |
| --- | --- | --- | --- |
| VP-A01 | Select trust transport | Explicit accepted ADR: shared Auth/namespace or verified OAuth2/SSR; no accidental hybrid | **DECISION PENDING** |
| VP-A02 | Account collision/proof | Existing standalone identity links with proof of control, stable provider subject, no same-email takeover, safe unlinking and return login | **PENDING** |
| VP-A03 | JWT/session and revocation | Wrong issuer/audience, expired or already revoked session, forged user metadata, stale Coach grant and multiple tabs denied | **PENDING** |
| VP-A04 | Role scope separation | `performance` entitlement allows entry but never access to another Org, sport/team, player or administrative action | **PENDING** |
| VP-A05 | Shared profile collision | Sports `public.profiles(user_id)` is namespaced/mapped safely; existing Website `public.profiles(id)`, Arcana and Reserve datasets remain unchanged | **PENDING SOURCE + CHOSEN MODEL** |
| VP-A06 | Account deletion/retention | Owner transfer, historic sport/athlete/coach records, minors' privacy rights, holds and immutable audit are resolved before account erase | **PRIVACY/LEGAL/OWNER GATE** |
| VP-A07 | Reversible migration rehearsal | Fingerprinted source/destination tables, synthetic migration/rollback, RLS and exact Auth/Storage/Edge compatibility if relevant, clean extraction | **BLOCKED UNTIL RESERVE GATES** |
| VP-A08 | Browser acceptance | Real consent/sign-in/return-to-Performance, permission change + reason, invite onboarding, multi-org switching, logout and recovery on mobile/desktop | **PENDING** |

**R — red: no permission from this preflight**

- **VP-R01:** Do not unpause, link, modify or migrate hosted Sports, Website or Reserve projects or import Sports schemas to shared `public`.
- **VP-R02:** Do not merge draft authentication/migration PRs, activate hosted OAuth, alter DNS, issue live invites or launch a production athlete/booking system.
- **VP-R03:** Do not delete Auth users or athlete history, email minors, import real school/student data, publish tokens/secrets, bypass RLS or infer roles from user metadata.
- **VP-R04:** Do not grant Performance organisation roles from a central platform entitlement, Reserve role or Arcana subscription.
- **VP-R05:** Do not incur new costs, create a duplicate production account authority or claim continuity during upstream outages without a reviewed offline-session policy.

## The actual migration gate, when later authorized

**Preconditions:** (1) Reserve architecture selected and migration/identity cutover independently accepted; (2) owner approves timing and protection of paused Sports project; (3) complete Performance source/migrations recovered and hashed; (4) full backups, historical data inventory and responsible contact identified; (5) rollback and tenant extraction proven; (6) one account-linking and closure policy accepted across Spheres.

**Proposed sequence:** read-only inventory → local namespacing/mapping generator → synthetic Auth/RLS cross-Sphere rehearsal → independent reviewer challenge tests → owner signoff → tightly bounded hosted staging plan → manual UAT → separately approved production cutover. The shared-backend option does **not** require moving or merging Performance's app repository into the Website repository.

## Cross-Sphere remainder after Reserve and Performance

1. **Arcana:** dedicated private `veni-arcana` repo already requires central Veni Account and entitlements. The more recent Controlled Implementation Handoff reports I0–I3b-1 closed, I3b-2 Golden Dawn research remaining a draft design review, and I4+/production persistence/UI/account integration **not authorized**. The repo README is older and does not supersede this handoff. Later prepare a separate identity, deck-entitlement, reading-history, deletion and WorldFrame/seasonal content contract when those integration milestones are authorized; do not block Performance's preflight on Arcana's ritual-method work.
2. **Platform:** settle the single identity-transport ADR; finish Website/Reserve OAuth browser proof OR shared Auth migration/recovery; prove token revocation, profile collision, cross-Sphere RLS, account deletion/retention, entitlements and exact restore/extraction.
3. **Product discovery:** preserve parent GitHub Pages `/kids/`; separate Veni Flow landing from Reserve/Performance product workflows and Arcana from both. Never change DNS, hosted provider or public routes under a docs-only PR.

## Required evidence before a Sports handover can be called execution-ready

- Exact local Performance repository or worktree **path or accessible remote**; GitHub account `venipublishing-main` currently has no Performance repository. Do **not** invent one or substitute Reserve's repo.
- Eleven migration filenames/checksums, table and RLS inventory, 28-test runner output, verified no-live-data inventory, compatible schema path, and current frontend/SSR wiring.
- Non-secret owner confirmation of paused project status and existing permitted access path; no credentials in documents.
- Independent manual application walkthrough and a labelled disposable fixture/test environment.

**Source references:** [ratified DEC-013](https://docs.google.com/document/d/1a9-onEXHMlqBzGiKFV52TAfMNsS5dC-5I71aZ2CyXHM/edit); [draft merger blueprint](https://docs.google.com/document/d/1SF0VqLmbFcXHVYVRza5CWTTLc9L_4iiMwR98Mq6Fz08/edit); [Website → Reserve draft PR #12](https://github.com/venipublishing-main/venipublishing-website/pull/12); [Reserve draft PR #25](https://github.com/venipublishing-main/veni-reserve/pull/25); prior Performance v0.8 handover and 14–15 Nov read-only audit. Previous Performance counts are handover-reported, not independently verified here.

**Filed for the Sports workstream:** [Veni Performance preflight and checklist Google Doc](https://docs.google.com/document/d/1i0kAXET4VV__8Dr5hM2qBEVAVQ4Jxhpl3M7h6glCUDs/edit) in [Veni Flow → Veni Performance](https://drive.google.com/drive/folders/1T5IlmDAm5_4kl6TlULCiPEaJVAqmGhE6); this draft does not replace the Sports team's own canonical implementation authority.
