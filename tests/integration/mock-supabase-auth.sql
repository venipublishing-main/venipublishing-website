-- Disposable Postgres-only approximation of the Supabase Auth surface.
-- This file is ONLY for the public GitHub Actions integration runner.
-- It does not seed or connect to any hosted Supabase project.
-- Roles are PostgreSQL-cluster global, while each test database has its own
-- auth schema. The extraction rehearsal uses two databases in one CI server.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin';
  end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable set search_path = '' as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Cloud Supabase normally supplies public grants; vanilla Postgres does not.
-- We deliberately supply only the SELECT privileges needed for the test.
grant usage on schema public to anon, authenticated;
