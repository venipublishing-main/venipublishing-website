# Reserve M7 private Theme revisions in the Website shared Auth prototype

**17 November 2026 · Local-only, draft, not a release or hosted migration approval**

The candidate extends the already separately proposed M2.2 tenant bootstrap
conversion. It reads the **exact** Reserve Theme migration from draft PR #22,

- `20261114110626_theme_revisions_private_drafts.sql`
- Git blob `457669782a5dcb00f3c851f89c9f3cd7fa0b959f`

and generates a sixth nondeployable SQL preview. It does not modify the Reserve
source repository or any live Supabase project.

| Source object | Website-owned shared prototype |
| --- | --- |
| `private.themes` | `reserve_internal.themes` |
| `private.theme_revisions` | `reserve_internal.theme_revisions` |
| `private.theme_revision_events` | `reserve_internal.theme_revision_events` |
| `private.published_theme_assignments` | `reserve_internal.published_theme_assignments` (still unwriteable) |
| `public.users/tenants/memberships` references | same IDs in `reserve.*` |
| `veni_theme_executor` | independent `reserve_theme_executor` (NOLOGIN, NOBYPASSRLS, NOINHERIT) |
| Five `public.<Theme RPC>` | `public.reserve_<Theme RPC>`; no publish RPC |

The proposed converter retains exact typed, three-field appearance tokens,
immutable revision/event triggers, composite foreign keys, deferrable active
draft pointer, tenant-scoped read/edit permissions, current Auth-session check,
and a private **closed** publication table. Neither branding uploads nor public
booking appearance is implemented here.

The draft workflow starts native disposable Supabase GoTrue/PostgREST and
rebuilds the combined Website, Arcana, Reserve M1, M2.1, M2.2 and M7 SQL. It
tests concurrent Owner onboarding, Theme creation/read/revision/history,
stale-version and cross-Tenant denial, malicious CSS/URL rejection, immutable
tables, inactive publisher path, revoked JWTs, and intact Website/Arcana data.

## Remaining non-negotiable conditions

- Green local CI alone never permits hosted migration, data export, account
  deletion, merge, DNS, cloud deployment, payment, or use of real patient data.
- The Website source-to-target import/export/independent recovery prototypes
  currently cover M1/M2.1, not M2.2/M7. Both new executor roles and all four
  new Theme tables must be included in a *reviewed* third-cluster recovery and
  extraction rehearsal. This is deliberately a later increment.
- The Website account-deletion handler still needs a coordinated Reserve
  preflight, and cross-Sphere revocation remains a release blocker.
- Shared server adapters, physical browser sign-in, Reserve UI route gate,
  private Theme Editor wire-up, actual practice/customer consent and ownership
  decisions are not implemented.
- Veni Performance remains paused at its hosted project while its migration
  is investigated using code, read-only evidence and synthetic fixtures.

The decision remains **Option A for local development only**: shared Veni
Account authentication, but independent Reserve Tenant/Membership/capability
authority; no implicit practice access from a login or from other Veni Spheres.
