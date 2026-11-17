# Reserve private-history import and independent recovery — disposable candidate

Status: DRAFT, not an execution approval. Parent: Website draft PR #16 (Theme
isolation), itself stacked on draft PR #14 (bootstrap) and the Website account
contract. No hosted SQL has been run.

## What this batch proves

The existing M1 synthetic GoTrue source-to-target transfer is retained. Both
independent stacks are extended with the source-controlled M2.1 settings,
M2.2 bootstrap and M7 private Theme schemas. The Reserve source is checked
out at exact commit 39497d603c7096a74676344ce364a5fd000632d3;
all six SQL origins are separately pinned by the Website converters.

After the original five Reserve GoTrue accounts have migrated, a new test
executes using their real local Auth sessions:

1. An initially unassigned account creates one new SETUP tenant through the
   actual Reserve bootstrap RPC. Repeating the same UUID key returns the same
   tenant and membership, proving the receipt was genuinely issued and replayed.
2. Existing and newly bootstrapped tenants save two separate M2.1 business
   settings snapshots. The source also creates two M7 private Theme records,
   including an updated second revision on the older tenant. There are three
   immutable revision records and three matching events.
3. The transfer manifest copies the additional tenant, membership, Owner
   role, two audit events, actual bootstrap receipt, settings snapshots and
   immutable changes, Theme records, revisions and events. It deliberately
   aborts after transferring revision rows and verifies *all* rows roll back,
   including original Website/Arcana/Auth counts.
4. A second, committed serializable transfer compares exact source and target
   CSV values for every imported relation. Target real GoTrue sessions then
   replay the original receipt, read the earlier Theme revision, reject a stale
   update and deny another tenant access. Publication remains closed.
5. A third independent local Supabase/PostgreSQL stack receives a custom-format
   snapshot. The restore rebuilds only the three reviewed NOLOGIN Reserve
   executors, reassigns their restricted functions to the *matching* source
   owners, and removes temporary explicit grants and schema creation rights.
   Role membership must match the source baseline exactly. The verifier compares full table
   digests, grants, RLS policies, trigger definitions, restricted role settings,
   and function ownership. It explicitly checks retained receipt, private
   settings and history, immutable event guards and zero published assignments.
   Existing independent GoTrue/password-recovery and direct full-clone startup
   checks remain in the workflow.

All contacts, accounts, themes and practice names are generated or
example.invalid synthetic fixtures. Each DB URL is required to be loopback on
a disposable Supabase CLI port. No application operator or real patient data
is imported. No new hosted Supabase project is required.

## Explicit remaining gates

- The synthetic staged M1 + M2.1/M2.2/M7 delta exercise does not prove a
  single atomic production cutover for all historical data, or interruption
  recovery halfway through an actual hosted project switch.
- Shared customer billing, app-specific permissions, future production bookings,
  appointment/import historical data, practice integrations, browser UX and
  account deletion are not established by this job.
- Hosted database Auth/MFA/OAuth/provider configuration, signing key rotation,
  Storage files, Vault secrets and environment-specific settings require their
  own reviewed migration plan.
- Veni Performance remains outside this rehearsal; pausing its hosted Supabase
  project is not authorization to migrate, delete or reactivate it.
- Do not merge these stacked drafts, run against a hosted database, pause the
  source project or delete anything on the basis of this synthetic CI alone.

The result is an independently testable recovery *candidate*, not a production
cutover instruction.
