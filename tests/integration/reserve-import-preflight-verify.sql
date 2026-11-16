-- Execute in the disposable WEBSITE destination *before* import, after an
-- intentionally failing import, and in a restored-from-backup database.
do $$ begin
  if (select count(*) from auth.users) <> 2
    or (select count(*) from public.profiles) <> 2
    or (select count(*) from public.arcana_readings) <> 1
    or (select count(*) from public.entitlements) <> 1
    or (select count(*) from public.products) < 1
    or (select count(*) from reserve.users) <> 0
    or (select count(*) from reserve.tenants) <> 0
    or (select count(*) from reserve.memberships) <> 0
    or (select count(*) from reserve.audit_events) <> 0
    or (select count(*) from reserve_internal.invitations) <> 0
    or (select count(*) from reserve.roles where kind='CUSTOM') <> 0 then
    raise exception 'Source import altered initial Website/Reserve state or backup restore differed';
  end if;
  if not exists(select 1 from public.profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or not exists(select 1 from public.profiles where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'Original Website users must remain intact';
  end if;
end $$;

select 'PASS: Website baseline, zero dynamic Reserve rows, restore integrity' as result;
