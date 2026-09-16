-- Maç kadroları (diziliş + ilk 11 + yedek) fixture_details üzerinde
alter table public.fixture_details
  add column if not exists lineups jsonb;
