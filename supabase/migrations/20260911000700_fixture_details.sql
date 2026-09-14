-- Maç detayı önbelleği: olaylar (gol, kart, değişiklik, VAR) ve istatistikler.
-- fixture-detail Edge Function'ı istek üzerine API'den çekip buraya yazar;
-- canlı maçta 20 sn, bitmiş maçta kalıcı önbellek.
create table if not exists public.fixture_details (
  fixture_id  bigint primary key references public.fixtures(id) on delete cascade,
  events      jsonb not null default '[]'::jsonb,
  statistics  jsonb not null default '[]'::jsonb,
  final       boolean not null default false,   -- maç bittikten sonra çekildi, artık değişmez
  updated_at  timestamptz not null default now()
);

alter table public.fixture_details enable row level security;

drop policy if exists "fixture_details_read" on public.fixture_details;
create policy "fixture_details_read" on public.fixture_details
  for select to authenticated using (true);

revoke insert, update, delete, truncate on public.fixture_details from anon, authenticated;
