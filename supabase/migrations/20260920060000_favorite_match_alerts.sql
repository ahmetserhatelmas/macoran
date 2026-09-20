-- Favori maçlar: yıldız sunucuda, bildirim hem kupon hem favoriye gider

create table if not exists public.favorite_fixtures (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  fixture_id  bigint not null references public.fixtures (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);
create index if not exists favorite_fixtures_fixture_idx on public.favorite_fixtures (fixture_id);

alter table public.favorite_fixtures enable row level security;
drop policy if exists "favorites: own" on public.favorite_fixtures;
create policy "favorites: own" on public.favorite_fixtures
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.favorite_fixtures to authenticated;
grant all on public.favorite_fixtures to service_role;

create or replace function public.notify_fixture_followers(
  p_fixture_id bigint, p_type text, p_title text, p_body text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, fixture_id)
  select distinct u.uid, p_type, p_title, p_body, p_fixture_id
    from (
      select b.user_id as uid
        from public.bet_selections s
        join public.bets b on b.id = s.bet_id
       where s.fixture_id = p_fixture_id
         and s.status = 'pending'
         and b.status = 'pending'
      union
      select f.user_id
        from public.favorite_fixtures f
       where f.fixture_id = p_fixture_id
    ) u;
end;
$$;
grant execute on function public.notify_fixture_followers(bigint, text, text, text) to service_role;
