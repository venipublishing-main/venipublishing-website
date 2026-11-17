-- CI-ONLY append-only operator receipt ledger. Not a hosted migration.
-- It deliberately retains target UUID without a FK so hard deletion does not
-- destroy the evidence. No raw email, password, token or secret is stored.
begin;
create schema if not exists venicleanup_ci;
revoke all on schema venicleanup_ci from public, anon, authenticated, service_role;

create table if not exists venicleanup_ci.receipts (
  event_id uuid primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  outcome text not null check(outcome in
    ('DENIED','PREPARED','SUCCEEDED','FAILED','COMPENSATED')),
  operator_id text not null check(operator_id ~ '^ci:[a-z0-9_-]{5,80}$'),
  reason text not null check(length(reason) between 10 and 500),
  target_auth_id uuid not null,
  target_email_sha256 text not null check(target_email_sha256 ~ '^[0-9a-f]{64}$'),
  plan_sha256 text not null check(plan_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object')
);
revoke all on venicleanup_ci.receipts from public, anon, authenticated, service_role;
alter table venicleanup_ci.receipts enable row level security;

create function venicleanup_ci.reject_receipt_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='23514', message='Synthetic cleanup evidence is append-only';
end $$;
revoke all on function venicleanup_ci.reject_receipt_mutation()
  from public, anon, authenticated, service_role;
create trigger receipts_immutable before update or delete or truncate
  on venicleanup_ci.receipts for each statement
  execute function venicleanup_ci.reject_receipt_mutation();
commit;
