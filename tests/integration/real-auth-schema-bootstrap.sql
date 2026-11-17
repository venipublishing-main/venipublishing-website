-- CI-only Supabase CLI migration payload. It allows PostgREST to load an
-- explicitly configured reserve API schema before the M1 fixtures are applied.
-- Never includes hosted data or grants.
create schema if not exists reserve;
