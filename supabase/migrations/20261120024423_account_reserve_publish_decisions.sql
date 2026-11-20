begin;

-- Account operators record an independently verified organization and business binding.
create schema veni_account_entitlements;
revoke all on schema veni_account_entitlements from public, anon, authenticated, service_role;
create table veni_account_entitlements.organizations (
  id uuid primary key
);
create table veni_account_entitlements.reserve_businesses (
  business_id uuid primary key references reserve.tenants(id),
  organization_id uuid not null references veni_account_entitlements.organizations(id),
  unique (business_id, organization_id)
);
create table veni_account_entitlements.reserve_publish_grants (
  decision_id uuid primary key,
  business_id uuid not null,
  organization_id uuid not null,
  basis text not null check (basis in ('subscription','free_pilot')),
  valid_from timestamptz not null check (isfinite(valid_from)),
  expires_at timestamptz not null check (isfinite(expires_at) and expires_at > valid_from),
  revoked_at timestamptz check (isfinite(revoked_at)),
  foreign key (business_id, organization_id)
    references veni_account_entitlements.reserve_businesses(business_id, organization_id)
);
-- Close the prior decision before inserting a successor. Keep its history.
create unique index reserve_one_open_publish_grant
  on veni_account_entitlements.reserve_publish_grants (business_id) where revoked_at is null;
alter table veni_account_entitlements.organizations enable row level security;
alter table veni_account_entitlements.reserve_businesses enable row level security;
alter table veni_account_entitlements.reserve_publish_grants enable row level security;
revoke all on all tables in schema veni_account_entitlements from public, anon, authenticated, service_role;

grant usage on schema veni_account_entitlements to reserve_onboarding_executor;
grant select on veni_account_entitlements.reserve_publish_grants to reserve_onboarding_executor;
create policy reserve_owner_decision on veni_account_entitlements.reserve_publish_grants
  for select to reserve_onboarding_executor using (reserve_internal.onboarding_owner(business_id));

create or replace function reserve_internal.account_publish_entitlement(target uuid)
returns table (business_id uuid, product text, capability text, basis text, valid_from timestamptz,
  expires_at timestamptz, revoked_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select g.business_id, 'reserve'::text, 'publish'::text, g.basis, g.valid_from, g.expires_at, g.revoked_at
  from veni_account_entitlements.reserve_publish_grants g
  where g.business_id = target and g.revoked_at is null
    and g.valid_from <= statement_timestamp() and statement_timestamp() < g.expires_at
$$;
-- CREATE OR REPLACE retains the existing private EXECUTE ACL.
commit;
