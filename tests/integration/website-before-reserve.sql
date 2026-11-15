-- Run in the same psql session as the post-merge assertions: temp snapshots
-- should never be persistent tables in the website's public schema.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test-a@example.invalid', '{"display_name":"Owner A"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test-b@example.invalid', '{"display_name":"Owner B"}');

insert into public.entitlements (user_id, product_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id
from public.products where slug = 'arcana-stage2-test';

insert into public.arcana_readings (user_id, title)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Before Reserve integration');

create temp table website_before as
select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.products) as products,
  (select count(*) from public.entitlements) as entitlements,
  (select count(*) from public.arcana_cards) as cards,
  (select count(*) from public.arcana_readings) as readings,
  (select count(*) from pg_catalog.pg_tables where schemaname = 'public') as public_tables,
  (select md5(string_agg(id::text || coalesce(display_name,''), '|' order by id)) from public.profiles) as profiles_digest,
  (select md5(string_agg(slug || ':' || status, '|' order by slug)) from public.products) as products_digest,
  (select md5(string_agg(slug || ':' || status, '|' order by slug)) from public.arcana_cards) as cards_digest;

grant select on public.profiles, public.products, public.entitlements,
  public.arcana_cards, public.arcana_readings to authenticated;
