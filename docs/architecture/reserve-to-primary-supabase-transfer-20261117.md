# Reserve consolidation into primary Veni Publishing Supabase

The primary project `droslqfcazwkwvqlbtsq` already records the nine migrations in
`supabase/migrations/*_reserve_shared_*.sql`. PR #26's earlier M1 candidate
is superseded. Reapplying it would collide with the existing tenant tables.
See the [versioned migration ledger](reserve-primary-supabase-migration-ledger-20261117.md).

The local replay uses the Website account foundation, the pinned Arcana pilot
schema and all nine Reserve migrations, with fresh synthetic accounts. Website
PRs #2, #14 and #16 supply the pinned converters. PR #18 supplies the private
history baseline. The Location, Service and Staff definitions match Reserve
through #30. The tests exercise the same Auth identity across products, tenant
isolation, session revocation, immutable history and optimistic revisions.

The application connects to the primary project via public `reserve_*` RPCs
and user-scoped tokens. Website consent is served at `/account/authorize/`.
Register the confidential staging client only after explicit hosted approval,
then add its public UUID, exact callback and email scope to
`assets/js/veni-oauth-clients.js`. Keep the secret with the Reserve Worker.
The Worker callback is `https://vf-reserve-stg.veni-reserve.workers.dev/auth/veni/callback`.

Verify the released Website consent page, staging Worker readiness, sign-in,
private workspace and logout before considering retirement of
`opjgaepryqwmsohtajja`. The source contains staging fixtures and stays active
through verification.
