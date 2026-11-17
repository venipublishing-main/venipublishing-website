# Reserve M2.2 tenant bootstrap — local Website conversion candidate

**17 November 2026. Draft only. No hosted schema, account, client or data change is authorized.**

## What changes locally

The Website-owned shared Supabase prototype already translates pinned Reserve M1
and M2.1 settings objects. This increment adds a separate, pinned converter for
Reserve's tenant-bootstrap source (`20261113111616_tenant_bootstrap.sql`, Git
blob `1660931b47eb5415eaa1bd64d284ea499b461479`). It writes an explicitly
non-deployable fifth SQL preview; it does not create any real migration file.

| Standalone Reserve | Shared local candidate |
| --- | --- |
| `public.tenants/users/memberships/roles/membership_roles/audit_events` | `reserve.*` |
| `private.authenticated_session_user`, `private.bootstrap_setup_tenant`, receipt | `reserve_internal.*` |
| `veni_bootstrap_executor` | independent `reserve_bootstrap_executor` |
| `public.current_reserve_user` | `public.reserve_current_reserve_user` |
| `public.bootstrap_setup_tenant` | `public.reserve_bootstrap_setup_tenant` |
| `public.list_setup_tenants` | `public.reserve_list_setup_tenants` |
| `public.read/save_tenant_business_settings` | `public.reserve_read/save_tenant_business_settings` |

The restricted executor has no new grants to Website public tables. All
non-business internal objects use a schema that is not exposed through the
Data API. The shared-Veni login UUID is projected into the Reserve user table
only at an authenticated **live-session** bootstrap, then becomes Owner in one
new SETUP Tenant; a login alone does not create a practice account or confer
permission in any existing practice.

The conversion retains the original `SERIALIZABLE` transaction requirement,
idempotency receipt, Owner invariant, two audit events, policy-bound NOLOGIN
executor and rejection of signed-out JWTs. The test runs against a *disposable
native GoTrue/PostgREST* process, not just synthetic JWT settings.

## Proof required before this can be called integrated

1. Exact Git-blob source verification and fail-closed namespace/permission
   whitelists; refusal to put the output under `supabase/migrations`.
2. Reconstruct the Website + Arcana + Reserve M1 + Reserve M2.1 + bootstrap
   schema in a fresh local Supabase stack.
3. Register real synthetic Auth users; concurrent/replayed requests create one
   SETUP Tenant and exactly one active Owner Membership, two audit events and
   one idempotency receipt. Different users/keys remain isolated.
4. Verify persistent practice settings and cross-Tenant RLS, forged metadata
   denial, rollback of a deliberately broken audit insert, and denial after a
   genuine provider session is revoked.
5. Confirm Website profile access and Arcana journal writes survive every
   Reserve operation. Test private schema/role/RPC grants independently.

## Explicit gaps and release blocks

- The existing Reserve local OAuth proposal calls the *standalone* RPC URL
  `/rest/v1/rpc/current_reserve_user`. A later, separately reviewed Website
  adapter must use `reserve_current_reserve_user`; no Worker route was changed.
- The Reserve Theme revision migration PR #22 is **not** converted by this
  increment; it needs another pinned, independent pass.
- Existing shared recovery/extraction, new executor role provisioning,
  per-Sphere account deletion, storage, Vault, sign-out propagation and
  rollback/cutover need a complete new review. A passing local replay is **not**
  permission to change hosted Auth, move practices, merge a PR or turn on login.
- Veni Performance remains separate and can be investigated without activating
  its paused hosted Supabase project. The $0 proof-of-concept constraint holds.

## Reproduction (safe, local only)

```sh
node --test tests/merge-reserve-bootstrap.test.mjs
node scripts/merge-reserve-bootstrap.mjs \
  --reserve-root /path/to/pinned-veni-reserve \
  --out-dir /tmp/disposable-veni-m22-preview
```

The GitHub Actions workflow
`.github/workflows/reserve-shared-bootstrap-candidate.yml` runs the real
disposable-Auth and PostgREST proof. No hosted project reference, remote
key, DNS change, account deletion or deployment operation is present.
