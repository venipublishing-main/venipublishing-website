-- Transactional, rollback-only simulation of removing both Reserve schemas
-- from the synthetic shared database. Never run this on a hosted project.
begin;
drop schema reserve_internal, reserve cascade;
do $$
begin
  if to_regclass('reserve.tenants') is not null
    or to_regclass('reserve_internal.invitations') is not null then
    raise exception 'Reserve removal drill left domain tables behind';
  end if;
  if (select count(*) from public.profiles) <> 3
    or (select count(*) from public.arcana_readings) <> 1
    or (select count(*) from public.products) < 1
    or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'Removing Reserve damaged the website account or Arcana foundation';
  end if;
  if not exists (select 1 from public.profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or not exists (select 1 from public.profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
    raise exception 'Removing Reserve damaged existing or newly-created Veni users';
  end if;
end $$;
rollback;

-- The rollback means the original shared database still has Reserve intact.
do $$ begin
  if to_regclass('reserve.tenants') is null
    or (select count(*) from public.profiles) <> 3 then
    raise exception 'Reversible Reserve removal drill failed to roll back cleanly';
  end if;
end $$;

select 'Website unaffected by simulated Reserve removal; shared database rolled back' as removal_result;
