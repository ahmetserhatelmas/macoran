-- =====================================================================
--  SİMÜLASYON LİGİ
--  Maçlar artık API-Football'dan değil, kendi simülasyon motorumuzdan
--  oynanır. Ligler / takımlar / logolar API'den gelen veriyle aynı kalır.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ayarlar (tek satır)
-- ---------------------------------------------------------------------
create table if not exists public.sim_settings (
  id                    int primary key default 1 check (id = 1),
  seconds_per_minute    int not null default 60,     -- 1 maç dakikası kaç gerçek saniye
  halftime_seconds      int not null default 600,    -- devre arası süresi
  goal_suspend_seconds  int not null default 40,     -- gol/kırmızı/penaltı sonrası oran askı süresi
  margin                numeric(5,4) not null default 0.08,  -- maç öncesi bahis marjı
  live_margin           numeric(5,4) not null default 0.10,  -- canlı bahis marjı
  last_tick_at          timestamptz,
  last_tick_message     text,
  updated_at            timestamptz not null default now()
);
insert into public.sim_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) Fikstür: simülasyon işaretleri
-- ---------------------------------------------------------------------
alter table public.fixtures add column if not exists is_sim   boolean not null default false;
alter table public.fixtures add column if not exists archived boolean not null default false;
create index if not exists fixtures_archived_idx on public.fixtures (archived) where archived = false;

-- Simülasyon fikstür kimlikleri (API kimlikleriyle çakışmaz)
create sequence if not exists public.sim_fixture_seq start with 900000001;

alter table public.leagues add column if not exists sim_started_at timestamptz;
alter table public.leagues add column if not exists sim_config     jsonb;
alter table public.leagues add column if not exists odds_dirty_at  timestamptz;  -- güç değişti, maç öncesi oranlar yenilenmeli

-- ---------------------------------------------------------------------
-- 3) Lig-takım üyeliği ve takım güçleri
-- ---------------------------------------------------------------------
create table if not exists public.league_teams (
  league_id  int not null references public.leagues (id) on delete cascade,
  team_id    int not null references public.teams (id) on delete cascade,
  primary key (league_id, team_id)
);

create table if not exists public.team_ratings (
  team_id      int primary key references public.teams (id) on delete cascade,
  league_id    int references public.leagues (id) on delete set null,
  attack       numeric(5,2) not null default 65,
  midfield     numeric(5,2) not null default 65,
  defense      numeric(5,2) not null default 65,
  goalkeeper   numeric(5,2) not null default 65,
  -- simülasyon sezonundaki performans (etkin güç bunlarla karışır)
  sim_played   int not null default 0,
  sim_points   int not null default 0,
  sim_gf       int not null default 0,
  sim_ga       int not null default 0,
  sim_form     text not null default '',         -- son 5 maç, ör. WDLWW
  source       text,                             -- 'standings' | 'manual'
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4) Oyuncular ve sezon istatistikleri
-- ---------------------------------------------------------------------
create table if not exists public.players (
  id                bigserial primary key,
  api_id            int,
  team_id           int not null references public.teams (id) on delete cascade,
  name              text not null,
  number            int,
  position          text not null check (position in ('GK','DEF','MID','FWD')),
  age               int,
  photo             text,
  -- 0..1 arası yetenek bileşenleri
  talent            numeric(4,3) not null default 0.5,   -- genel seviye (ilk 11 seçimi)
  finishing         numeric(4,3) not null default 0.5,   -- gol atma eğilimi
  creativity        numeric(4,3) not null default 0.5,   -- asist eğilimi
  aggression        numeric(4,3) not null default 0.5,   -- kart eğilimi
  injured_until     timestamptz,
  suspended_matches int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists players_team_idx on public.players (team_id);
create unique index if not exists players_api_idx on public.players (api_id) where api_id is not null;

create table if not exists public.player_stats (
  player_id   bigint not null references public.players (id) on delete cascade,
  league_id   int not null references public.leagues (id) on delete cascade,
  apps        int not null default 0,
  goals       int not null default 0,
  assists     int not null default 0,
  yellow      int not null default 0,
  red         int not null default 0,
  minutes     int not null default 0,
  primary key (player_id, league_id)
);
create index if not exists player_stats_goals_idx   on public.player_stats (league_id, goals desc);
create index if not exists player_stats_assists_idx on public.player_stats (league_id, assists desc);

-- ---------------------------------------------------------------------
-- 5) Simüle edilen maçlar
-- ---------------------------------------------------------------------
create table if not exists public.sim_matches (
  fixture_id       bigint primary key references public.fixtures (id) on delete cascade,
  seed             bigint not null,
  scenario         jsonb,                 -- admin senaryosu: {ht_home, ht_away, ft_home, ft_away, note}
  script           jsonb,                 -- kickoff'ta üretilen tam maç senaryosu (olaylar, istatistikler)
  facts            jsonb,                 -- maç sonu gerçekleri (sonuçlandırma için)
  kickoff_at       timestamptz,           -- gerçek zamanda başlama anı
  second_half_at   timestamptz,           -- 2. yarının gerçek başlama anı
  revealed         int not null default 0,   -- script.events içinde işlenen olay sayısı
  last_minute      int not null default 0,   -- son işlenen maç dakikası
  odds_minute      int not null default -1,  -- canlı oranların hesaplandığı maç dakikası
  suspended_until  timestamptz,           -- gol vb. sonrası oran askısı
  created_at       timestamptz not null default now()
);
create index if not exists sim_matches_kickoff_idx on public.sim_matches (kickoff_at);

-- ---------------------------------------------------------------------
-- 6) RLS / yetkiler
-- ---------------------------------------------------------------------
alter table public.sim_settings  enable row level security;
alter table public.league_teams  enable row level security;
alter table public.team_ratings  enable row level security;
alter table public.players       enable row level security;
alter table public.player_stats  enable row level security;
alter table public.sim_matches   enable row level security;

drop policy if exists "sim_settings read"  on public.sim_settings;
drop policy if exists "league_teams read"  on public.league_teams;
drop policy if exists "team_ratings read"  on public.team_ratings;
drop policy if exists "players read"       on public.players;
drop policy if exists "player_stats read"  on public.player_stats;
drop policy if exists "sim_matches admin"  on public.sim_matches;

create policy "sim_settings read" on public.sim_settings for select to authenticated using (true);
create policy "league_teams read" on public.league_teams for select to authenticated using (true);
create policy "team_ratings read" on public.team_ratings for select to authenticated using (true);
create policy "players read"      on public.players      for select to authenticated using (true);
create policy "player_stats read" on public.player_stats for select to authenticated using (true);
-- Script sürprizi bozmasın: sim_matches sadece admin okur (istemci yalnızca scenario sütununu çeker)
create policy "sim_matches admin" on public.sim_matches for select to authenticated using (public.is_admin());

revoke insert, update, delete, truncate on
  public.sim_settings, public.league_teams, public.team_ratings, public.players, public.player_stats, public.sim_matches
  from anon, authenticated;
revoke all on public.sim_settings, public.league_teams, public.team_ratings, public.players, public.player_stats, public.sim_matches from anon;
grant select on public.sim_settings, public.league_teams, public.team_ratings, public.players, public.player_stats, public.sim_matches to authenticated;
grant all on public.sim_settings, public.league_teams, public.team_ratings, public.players, public.player_stats, public.sim_matches to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.settle_bet(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 7) Realtime trafiğini azalt
--    - odds tablosu yayından çıkar (istemci zaten 10-15 sn'de bir sorguluyor)
--    - fixtures: değişmeyen satır güncellemeleri yazılmaz
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime drop table public.odds;
exception when others then null;
end $$;

create or replace function public.fixtures_skip_unchanged()
returns trigger
language plpgsql
as $$
begin
  if new.status_short = old.status_short
     and new.elapsed is not distinct from old.elapsed
     and new.home_goals is not distinct from old.home_goals
     and new.away_goals is not distinct from old.away_goals
     and new.ht_home is not distinct from old.ht_home
     and new.ht_away is not distinct from old.ht_away
     and new.ft_home is not distinct from old.ft_home
     and new.ft_away is not distinct from old.ft_away
     and new.live_odds_at is not distinct from old.live_odds_at
     and new.settled = old.settled
     and new.archived = old.archived
     and new.date = old.date
     and new.round is not distinct from old.round then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists fixtures_skip_unchanged on public.fixtures;
create trigger fixtures_skip_unchanged
  before update on public.fixtures
  for each row execute function public.fixtures_skip_unchanged();

-- ---------------------------------------------------------------------
-- 8) Sonuçlandırma: seçim durumlarını motor hesaplar, kuponları DB kapatır
--    p_results: [{id, status:'won'|'lost'|'void'}]
-- ---------------------------------------------------------------------
create or replace function public.sim_settle_fixture(p_fixture_id bigint, p_results jsonb, p_home int, p_away int)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_r       jsonb;
  v_bet_ids uuid[] := '{}';
  v_bid     uuid;
  v_n       int := 0;
begin
  for v_r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.bet_selections
       set status = (v_r ->> 'status')::public.bet_status,
           result_home = p_home,
           result_away = p_away
     where id = (v_r ->> 'id')::uuid
       and fixture_id = p_fixture_id
       and status = 'pending'
    returning bet_id into v_bid;
    if v_bid is not null then
      v_bet_ids := array_append(v_bet_ids, v_bid);
      v_n := v_n + 1;
    end if;
  end loop;

  select coalesce(array_agg(distinct x), '{}') into v_bet_ids from unnest(v_bet_ids) x;
  foreach v_bid in array v_bet_ids loop
    perform public.settle_bet(v_bid);
  end loop;

  update public.fixtures set settled = true where id = p_fixture_id;
  return v_n;
end;
$$;
grant execute on function public.sim_settle_fixture(bigint, jsonb, int, int) to service_role;

-- Bir ligin arşivlenen (API dönemi) fikstürlerindeki bekleyen seçimleri iade et
create or replace function public.void_fixture_bets(p_fixture_ids bigint[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_bet_ids uuid[];
  v_bid     uuid;
  v_n       int;
begin
  with upd as (
    update public.bet_selections set status = 'void'
     where fixture_id = any (p_fixture_ids) and status = 'pending'
    returning bet_id
  )
  select coalesce(array_agg(distinct bet_id), '{}'), count(*) into v_bet_ids, v_n from upd;
  foreach v_bid in array v_bet_ids loop
    perform public.settle_bet(v_bid);
  end loop;
  return v_n;
end;
$$;
grant execute on function public.void_fixture_bets(bigint[]) to service_role;

-- ---------------------------------------------------------------------
-- 9) Admin istatistikleri: simülasyon durumu
-- ---------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'users',        (select count(*) from public.profiles),
    'total_balance',(select coalesce(sum(balance),0) from public.profiles),
    'open_bets',    (select count(*) from public.bets where status = 'pending'),
    'total_bets',   (select count(*) from public.bets),
    'live_fixtures',(select count(*) from public.fixtures where status_short in ('1H','HT','2H','ET','BT','P','LIVE','INT') and archived = false),
    'sim',          (select jsonb_build_object(
                        'last_tick_at', s.last_tick_at, 'last_tick_message', s.last_tick_message,
                        'seconds_per_minute', s.seconds_per_minute, 'halftime_seconds', s.halftime_seconds,
                        'goal_suspend_seconds', s.goal_suspend_seconds, 'margin', s.margin, 'live_margin', s.live_margin,
                        'started_leagues', (select count(*) from public.leagues where sim_started_at is not null),
                        'players', (select count(*) from public.players),
                        'upcoming', (select count(*) from public.fixtures where is_sim and status_short = 'NS' and archived = false)
                      ) from public.sim_settings s where s.id = 1),
    'last_sync',    (select jsonb_agg(jsonb_build_object('job', job, 'ok', ok, 'message', message, 'requests', requests, 'at', created_at))
                       from (select distinct on (job) * from public.sync_logs order by job, created_at desc) s)
  ) else null end;
$$;

-- ---------------------------------------------------------------------
-- 10) Zamanlayıcı: API senkronları kapanır, simülasyon 15 sn'de bir çalışır
-- ---------------------------------------------------------------------
do $$
declare j text;
begin
  foreach j in array array['macoran-sync-live','macoran-sync-odds','macoran-sync-fixtures','macoran-sync-standings','macoran-sync-standings-dirty','macoran-sim-tick'] loop
    begin
      perform cron.unschedule(j);
    exception when others then null;
    end;
  end loop;
end $$;

select cron.schedule('macoran-sim-tick', '15 seconds', $$select public.invoke_edge('sim-tick')$$);
