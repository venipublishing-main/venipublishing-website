-- Veni Publishing production migration: reviewed pinned Reserve source (foundation/preview-1-m1a.sql); additively isolated under reserve, reserve_internal and namespaced RPCs. Applied as Supabase migration version 20261117160650.
begin;
create schema if not exists reserve;
revoke all on schema reserve from public, anon, authenticated, service_role;

-- M1.1A / AR-026: persistence only. Roles, ownership and access workflows follow later.
-- Text CHECKs keep the small, table-specific vocabularies explicit and easy to migrate.
-- Lifecycle states deliberately have no defaults: callers must choose explicitly.
create table reserve.tenants (
  id uuid primary key default gen_random_uuid(),
  status text not null constraint tenants_status_check
    check (status in ('SETUP', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at timestamptz not null default now()
);

create table reserve.users (
  id uuid primary key constraint users_auth_user_fkey
    references auth.users (id) on update restrict on delete restrict,
  created_at timestamptz not null default now()
);

create table reserve.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null constraint memberships_tenant_fkey
    references reserve.tenants (id) on update restrict on delete restrict,
  user_id uuid not null constraint memberships_user_fkey
    references reserve.users (id) on update restrict on delete restrict,
  status text not null constraint memberships_status_check
    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at timestamptz not null default now(),
  constraint memberships_tenant_user_key unique (tenant_id, user_id)
);

-- The unique index covers tenant-first lookups; this covers a User's memberships
-- and the referencing side of users -> memberships deletion checks.
create index memberships_user_id_idx on reserve.memberships (user_id);

-- Retain history by changing lifecycle state, not cascading identity deletion.
-- No updated_at or transition audit is introduced in this persistence slice.
comment on table reserve.users is
  'Global application identity projection; auth.users owns authentication. No tenant authority.';
comment on table reserve.memberships is
  'One durable User/Tenant relationship. Lifecycle persistence alone does not grant authority.';

alter table reserve.tenants enable row level security;
alter table reserve.users enable row level security;
alter table reserve.memberships enable row level security;

-- Supabase may grant table privileges by default. Remove ordinary API access
-- explicitly; M1.2 will add the least privileges and policies its model requires.
revoke all on table reserve.tenants, reserve.users, reserve.memberships
  from public, anon, authenticated;
-- No policies: default-deny for RLS-subject roles. Owners/superusers/BYPASSRLS
-- roles are not blocked by this structural posture.
commit;
