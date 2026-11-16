-- Runs after PR #4's synthetic Reserve import into a disposable Website DB.
do $$ begin
  if not has_function_privilege('authenticated', 'public.reserve_account_deletion_preflight()', 'EXECUTE')
    or has_function_privilege('anon', 'public.reserve_account_deletion_preflight()', 'EXECUTE')
    or has_function_privilege('service_role', 'public.reserve_account_deletion_preflight()', 'EXECUTE') then
    raise exception 'Reserve account-deletion preflight must be self-only, authenticated, no service-wide privilege';
  end if;
  if exists (select 1 from pg_proc where oid='public.reserve_account_deletion_preflight()'::regprocedure
    and prosecdef) then
    raise exception 'Preflight must be SECURITY INVOKER, never BYPASSRLS';
  end if;
end $$;

-- Migrated Owner A (and, by symmetry, B) must transfer ownership first.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'OWNER_TRANSFER_REQUIRED' then
    raise exception 'Owner deletion did not require transfer';
  end if;
end $$;
commit;

-- A Staff member and a Reserve identity without membership still have FKs.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'RESERVE_HISTORY_REVIEW_REQUIRED' then
    raise exception 'Staff deletion ignored retained Reserve history';
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd5555555-5555-4555-8555-555555555555';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'RESERVE_HISTORY_REVIEW_REQUIRED' then
    raise exception 'Unassigned Reserve projection still blocks hard delete';
  end if;
end $$;
commit;

-- A pre-existing Website-only account has no Reserve ownership/history.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'RESERVE_CLEAR' then
    raise exception 'Website-only account incorrectly marked linked to Reserve';
  end if;
end $$;
commit;

-- A forged user-metadata field must have no effect on protected roles.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"is_anonymous":false,"user_metadata":{"role":"owner","tenant_id":"c1111111-1111-4111-8111-111111111111"}}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'RESERVE_CLEAR' then
    raise exception 'Mutable user_metadata conferred phantom Reserve ownership';
  end if;
end $$;
commit;

-- An anonymous Auth user that assumes authenticated Postgres role must not
-- get an affirmative deletion clearance based on invisible RLS rows.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"is_anonymous":true}';
do $$ begin
  if public.reserve_account_deletion_preflight() <> 'REAUTH_REQUIRED' then
    raise exception 'Anonymous identity must not receive Reserve clearance';
  end if;
end $$;
commit;

-- Unauthenticated anon role has no EXECUTE privilege, even if it invents a
-- request.jwt.claim.sub in a test transaction.
begin;
set local role anon;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"is_anonymous":false}';
do $$ begin
  begin
    perform public.reserve_account_deletion_preflight();
    raise exception 'Anonymous role reached protected preflight RPC';
  exception when insufficient_privilege then
    null;
  end;
end $$;
commit;

select 'PASS: security-invoker self-only deletion preflight denies owner/history and unsafe claims' as result;
