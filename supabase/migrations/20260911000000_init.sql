-- =====================================================================
--  MACORAN – Sanal para ile futbol bahis uygulaması
--  Şema, RLS, RPC fonksiyonları ve pg_cron zamanlayıcıları
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
--  TABLOLAR
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  username    text unique,
  balance     numeric(14, 2) not null default 0 check (balance >= 0),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.leagues (
  id          int primary key,            -- API-Football league id
  name        text not null,
  country     text,
  logo        text,
  flag        text,
  season      int not null,               -- güncel sezon (API'den otomatik güncellenir)
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

create table public.teams (
  id    int primary key,                  -- API-Football team id
  name  text not null,
  logo  text
);

create table public.fixtures (
  id             bigint primary key,      -- API-Football fixture id
  league_id      int not null references public.leagues (id),
  season         int not null,
  round          text,
  date           timestamptz not null,
  status_short   text not null default 'NS',
  status_long    text,
  elapsed        int,
  home_team_id   int not null references public.teams (id),
  away_team_id   int not null references public.teams (id),
  home_goals     int,
  away_goals     int,
  ht_home        int,
  ht_away        int,
  ft_home        int,
  ft_away        int,
  et_home        int,
  et_away        int,
  pen_home       int,
  pen_away       int,
  venue          text,
  settled        boolean not null default false,
  updated_at     timestamptz not null default now()
);
create index fixtures_date_idx on public.fixtures (date);
create index fixtures_league_date_idx on public.fixtures (league_id, date);
create index fixtures_status_idx on public.fixtures (status_short);

-- Normalize edilmiş oranlar. market: 1X2 | DC | OU | BTTS
-- selection: 1,X,2 | 1X,12,X2 | O,U (line ile) | YES,NO
create table public.odds (
  fixture_id  bigint not null references public.fixtures (id) on delete cascade,
  market      text not null,
  selection   text not null,
  line        numeric(5, 2) not null default 0,
  odd         numeric(8, 3) not null check (odd >= 1),
  suspended   boolean not null default false,
  is_live     boolean not null default false,
  bookmaker   text,
  updated_at  timestamptz not null default now(),
  primary key (fixture_id, market, selection, line)
);

create table public.standings (
  league_id   int primary key references public.leagues (id),
  season      int not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create type public.bet_status as enum ('pending', 'won', 'lost', 'void');

create table public.bets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  stake          numeric(14, 2) not null check (stake > 0),
  total_odd      numeric(12, 3) not null,
  potential_win  numeric(14, 2) not null,
  payout         numeric(14, 2),
  status         public.bet_status not null default 'pending',
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);
create index bets_user_idx on public.bets (user_id, created_at desc);

create table public.bet_selections (
  id            uuid primary key default gen_random_uuid(),
  bet_id        uuid not null references public.bets (id) on delete cascade,
  fixture_id    bigint not null references public.fixtures (id),
  market        text not null,
  selection     text not null,
  line          numeric(5, 2) not null default 0,
  odd           numeric(8, 3) not null,
  is_live       boolean not null default false,
  -- görüntüleme için anlık kopya
  home_name     text,
  away_name     text,
  league_name   text,
  fixture_date  timestamptz,
  status        public.bet_status not null default 'pending',
  result_home   int,
  result_away   int
);
create index bet_selections_fixture_idx on public.bet_selections (fixture_id) where status = 'pending';
create index bet_selections_bet_idx on public.bet_selections (bet_id);

create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(14, 2) not null,             -- + yükleme / - düşme
  type        text not null check (type in ('grant', 'deduct', 'bet', 'win', 'refund')),
  ref_id      uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index transactions_user_idx on public.transactions (user_id, created_at desc);

create table public.sync_logs (
  id          bigserial primary key,
  job         text not null,
  ok          boolean not null,
  message     text,
  requests    int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  20 LİG
-- ---------------------------------------------------------------------
insert into public.leagues (id, name, country, season, sort_order) values
  (203, 'Süper Lig',                    'Türkiye',      2026, 1),
  (204, '1. Lig',                       'Türkiye',      2026, 2),
  (39,  'Premier League',               'İngiltere',    2026, 3),
  (140, 'La Liga',                      'İspanya',      2026, 4),
  (135, 'Serie A',                      'İtalya',       2026, 5),
  (78,  'Bundesliga',                   'Almanya',      2026, 6),
  (61,  'Ligue 1',                      'Fransa',       2026, 7),
  (2,   'UEFA Şampiyonlar Ligi',        'Avrupa',       2026, 8),
  (3,   'UEFA Avrupa Ligi',             'Avrupa',       2026, 9),
  (848, 'UEFA Konferans Ligi',          'Avrupa',       2026, 10),
  (88,  'Eredivisie',                   'Hollanda',     2026, 11),
  (94,  'Primeira Liga',                'Portekiz',     2026, 12),
  (144, 'Jupiler Pro League',           'Belçika',      2026, 13),
  (179, 'Premiership',                  'İskoçya',      2026, 14),
  (40,  'Championship',                 'İngiltere',    2026, 15),
  (71,  'Serie A',                      'Brezilya',     2026, 16),
  (128, 'Liga Profesional',             'Arjantin',     2026, 17),
  (253, 'MLS',                          'ABD',          2026, 18),
  (262, 'Liga MX',                      'Meksika',      2026, 19),
  (307, 'Pro League',                   'S. Arabistan', 2026, 20);

-- ---------------------------------------------------------------------
--  YARDIMCI FONKSİYONLAR
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Yeni kullanıcı kaydında profil oluştur. Admin e-postası otomatik admin olur.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_username text;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
  if v_username is null then
    v_username := split_part(new.email, '@', 1) || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  insert into public.profiles (id, email, username, is_admin)
  values (
    new.id,
    lower(new.email),
    v_username,
    lower(new.email) = 'ahmetserhatelmas@gmail.com'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin e-postası daha önce kayıt olduysa bile admin kalır.
create or replace function public.ensure_admin_flag()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if lower(new.email) = 'ahmetserhatelmas@gmail.com' then
    new.is_admin := true;
  end if;
  return new;
end;
$$;
create trigger profiles_ensure_admin
  before insert or update of email on public.profiles
  for each row execute function public.ensure_admin_flag();

-- ---------------------------------------------------------------------
--  BAHİS OYNAMA (atomik)
--  selections: [{fixture_id, market, selection, line, odd}]
-- ---------------------------------------------------------------------
create or replace function public.place_bet(p_selections jsonb, p_stake numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_balance     numeric;
  v_sel         jsonb;
  v_fixture     public.fixtures%rowtype;
  v_odd_row     public.odds%rowtype;
  v_total_odd   numeric := 1;
  v_bet_id      uuid;
  v_count       int;
  v_fixture_ids bigint[] := '{}';
  v_live_states text[] := array['1H','HT','2H','ET','BT','P','LIVE','INT'];
  v_home_name   text;
  v_away_name   text;
  v_league_name text;
  v_client_odd  numeric;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_stake is null or p_stake < 1 then
    raise exception 'MIN_STAKE:1';
  end if;

  v_count := jsonb_array_length(coalesce(p_selections, '[]'::jsonb));
  if v_count < 1 or v_count > 15 then
    raise exception 'SELECTION_COUNT:1-15';
  end if;

  select balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if v_balance < p_stake then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  -- Seçimleri doğrula
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_fixture from public.fixtures where id = (v_sel ->> 'fixture_id')::bigint;
    if not found then
      raise exception 'FIXTURE_NOT_FOUND:%', v_sel ->> 'fixture_id';
    end if;

    if v_fixture.id = any (v_fixture_ids) then
      raise exception 'DUPLICATE_FIXTURE:%', v_fixture.id;
    end if;
    v_fixture_ids := array_append(v_fixture_ids, v_fixture.id);

    -- Maç bahse açık mı? (başlamamış veya canlı)
    if not (
      (v_fixture.status_short in ('NS','TBD') and v_fixture.date > now() - interval '3 minutes')
      or v_fixture.status_short = any (v_live_states)
    ) then
      raise exception 'FIXTURE_CLOSED:%', v_fixture.id;
    end if;

    select * into v_odd_row
      from public.odds
     where fixture_id = v_fixture.id
       and market     = v_sel ->> 'market'
       and selection  = v_sel ->> 'selection'
       and line       = coalesce((v_sel ->> 'line')::numeric, 0);
    if not found then
      raise exception 'ODD_NOT_FOUND:%', v_fixture.id;
    end if;
    if v_odd_row.suspended then
      raise exception 'ODD_SUSPENDED:%', v_fixture.id;
    end if;
    -- Canlı oran çok eskiyse (2 dk) kabul etme
    if v_odd_row.is_live and v_odd_row.updated_at < now() - interval '3 minutes' then
      raise exception 'ODD_STALE:%', v_fixture.id;
    end if;

    v_client_odd := (v_sel ->> 'odd')::numeric;
    if v_client_odd is null or abs(v_client_odd - v_odd_row.odd) > 0.001 then
      raise exception 'ODDS_CHANGED:%', v_fixture.id;
    end if;

    v_total_odd := v_total_odd * v_odd_row.odd;
  end loop;

  v_total_odd := round(v_total_odd, 3);

  -- Bakiyeyi düş
  update public.profiles set balance = balance - p_stake where id = v_uid;

  insert into public.bets (user_id, stake, total_odd, potential_win)
  values (v_uid, p_stake, v_total_odd, round(p_stake * v_total_odd, 2))
  returning id into v_bet_id;

  -- Seçimleri kaydet (anlık kopyalarla)
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_fixture from public.fixtures where id = (v_sel ->> 'fixture_id')::bigint;
    select th.name, ta.name, l.name
      into v_home_name, v_away_name, v_league_name
      from public.teams th, public.teams ta, public.leagues l
     where th.id = v_fixture.home_team_id
       and ta.id = v_fixture.away_team_id
       and l.id  = v_fixture.league_id;

    insert into public.bet_selections
      (bet_id, fixture_id, market, selection, line, odd, is_live,
       home_name, away_name, league_name, fixture_date)
    values
      (v_bet_id, v_fixture.id, v_sel ->> 'market', v_sel ->> 'selection',
       coalesce((v_sel ->> 'line')::numeric, 0), (v_sel ->> 'odd')::numeric,
       v_fixture.status_short = any (v_live_states),
       v_home_name, v_away_name, v_league_name, v_fixture.date);
  end loop;

  insert into public.transactions (user_id, amount, type, ref_id, note)
  values (v_uid, -p_stake, 'bet', v_bet_id, 'Kupon oynandı');

  return jsonb_build_object('bet_id', v_bet_id, 'total_odd', v_total_odd, 'balance', v_balance - p_stake);
end;
$$;

-- ---------------------------------------------------------------------
--  SONUÇLANDIRMA
-- ---------------------------------------------------------------------

-- Bir seçimin sonucunu hesapla. 90 dk sonucu esas alınır.
create or replace function public.evaluate_selection(
  p_market text, p_selection text, p_line numeric, p_home int, p_away int
) returns public.bet_status
language plpgsql immutable
as $$
declare
  v_total int := p_home + p_away;
begin
  case p_market
    when '1X2' then
      if p_selection = '1' then return case when p_home > p_away then 'won' else 'lost' end; end if;
      if p_selection = 'X' then return case when p_home = p_away then 'won' else 'lost' end; end if;
      if p_selection = '2' then return case when p_away > p_home then 'won' else 'lost' end; end if;
    when 'DC' then
      if p_selection = '1X' then return case when p_home >= p_away then 'won' else 'lost' end; end if;
      if p_selection = '12' then return case when p_home <> p_away then 'won' else 'lost' end; end if;
      if p_selection = 'X2' then return case when p_away >= p_home then 'won' else 'lost' end; end if;
    when 'OU' then
      if v_total = p_line then return 'void'; end if;  -- tam sayı çizgide iade
      if p_selection = 'O' then return case when v_total > p_line then 'won' else 'lost' end; end if;
      if p_selection = 'U' then return case when v_total < p_line then 'won' else 'lost' end; end if;
    when 'BTTS' then
      if p_selection = 'YES' then return case when p_home > 0 and p_away > 0 then 'won' else 'lost' end; end if;
      if p_selection = 'NO'  then return case when p_home = 0 or p_away = 0 then 'won' else 'lost' end; end if;
    else
      return 'void';
  end case;
  return 'void';
end;
$$;

-- Bir kuponu değerlendir: hepsi sonuçlandıysa kazanç dağıt.
create or replace function public.settle_bet(p_bet_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bet      public.bets%rowtype;
  v_pending  int;
  v_lost     int;
  v_odd      numeric := 1;
  v_payout   numeric;
begin
  select * into v_bet from public.bets where id = p_bet_id for update;
  if not found or v_bet.status <> 'pending' then return; end if;

  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'lost'),
         coalesce(exp(sum(ln(odd)) filter (where status = 'won')), 1)
    into v_pending, v_lost, v_odd
    from public.bet_selections where bet_id = p_bet_id;

  if v_lost > 0 then
    update public.bets set status = 'lost', payout = 0, settled_at = now() where id = p_bet_id;
    return;
  end if;

  if v_pending > 0 then return; end if;

  -- Hepsi kazandı ya da iade
  v_odd := round(v_odd, 3);
  v_payout := round(v_bet.stake * v_odd, 2);

  if v_odd = 1 then
    update public.bets set status = 'void', payout = v_payout, settled_at = now() where id = p_bet_id;
    update public.profiles set balance = balance + v_payout where id = v_bet.user_id;
    insert into public.transactions (user_id, amount, type, ref_id, note)
    values (v_bet.user_id, v_payout, 'refund', p_bet_id, 'Kupon iade edildi');
  else
    update public.bets set status = 'won', payout = v_payout, settled_at = now() where id = p_bet_id;
    update public.profiles set balance = balance + v_payout where id = v_bet.user_id;
    insert into public.transactions (user_id, amount, type, ref_id, note)
    values (v_bet.user_id, v_payout, 'win', p_bet_id, 'Kupon kazandı');
  end if;
end;
$$;

-- Bitmiş bir maçın tüm bekleyen seçimlerini sonuçlandır.
create or replace function public.settle_fixture(p_fixture_id bigint)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_f        public.fixtures%rowtype;
  v_home     int;
  v_away     int;
  v_sel      record;
  v_status   public.bet_status;
  v_n        int := 0;
  v_bet_ids  uuid[] := '{}';
  v_bid      uuid;
begin
  select * into v_f from public.fixtures where id = p_fixture_id for update;
  if not found or v_f.settled then return 0; end if;

  if v_f.status_short in ('FT','AET','PEN') then
    -- 90 dakika sonucu (fulltime varsa onu kullan)
    v_home := coalesce(v_f.ft_home, v_f.home_goals);
    v_away := coalesce(v_f.ft_away, v_f.away_goals);
    if v_home is null or v_away is null then return 0; end if;

    for v_sel in
      select * from public.bet_selections where fixture_id = p_fixture_id and status = 'pending'
    loop
      v_status := public.evaluate_selection(v_sel.market, v_sel.selection, v_sel.line, v_home, v_away);
      update public.bet_selections
         set status = v_status, result_home = v_home, result_away = v_away
       where id = v_sel.id;
      v_bet_ids := array_append(v_bet_ids, v_sel.bet_id);
      v_n := v_n + 1;
    end loop;

  elsif v_f.status_short in ('CANC','ABD','AWD','WO') then
    -- İptal / tatil: seçimler iade (void)
    for v_sel in
      select * from public.bet_selections where fixture_id = p_fixture_id and status = 'pending'
    loop
      update public.bet_selections set status = 'void' where id = v_sel.id;
      v_bet_ids := array_append(v_bet_ids, v_sel.bet_id);
      v_n := v_n + 1;
    end loop;
  else
    return 0;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_bet_ids from unnest(v_bet_ids) x;
  foreach v_bid in array v_bet_ids loop
    perform public.settle_bet(v_bid);
  end loop;

  update public.fixtures set settled = true where id = p_fixture_id;
  return v_n;
end;
$$;

-- Tüm bitmiş & sonuçlanmamış maçları işle (Edge Function tarafından çağrılır)
create or replace function public.settle_pending()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_total int := 0;
begin
  for v_id in
    select id from public.fixtures
     where settled = false
       and status_short in ('FT','AET','PEN','CANC','ABD','AWD','WO')
  loop
    v_total := v_total + public.settle_fixture(v_id);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
--  ADMİN İŞLEMLERİ
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_balance(p_user_id uuid, p_amount numeric, p_note text default null)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_new numeric;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.profiles
     set balance = balance + p_amount
   where id = p_user_id
  returning balance into v_new;

  if v_new is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.transactions (user_id, amount, type, note, created_by)
  values (p_user_id, p_amount, case when p_amount > 0 then 'grant' else 'deduct' end, p_note, auth.uid());

  return v_new;
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'users',        (select count(*) from public.profiles),
    'total_balance',(select coalesce(sum(balance),0) from public.profiles),
    'open_bets',    (select count(*) from public.bets where status = 'pending'),
    'total_bets',   (select count(*) from public.bets),
    'live_fixtures',(select count(*) from public.fixtures where status_short in ('1H','HT','2H','ET','BT','P','LIVE','INT')),
    'last_sync',    (select jsonb_agg(jsonb_build_object('job', job, 'ok', ok, 'message', message, 'requests', requests, 'at', created_at))
                       from (select distinct on (job) * from public.sync_logs order by job, created_at desc) s)
  ) else null end;
$$;

-- ---------------------------------------------------------------------
--  RLS
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.leagues         enable row level security;
alter table public.teams           enable row level security;
alter table public.fixtures        enable row level security;
alter table public.odds            enable row level security;
alter table public.standings       enable row level security;
alter table public.bets            enable row level security;
alter table public.bet_selections  enable row level security;
alter table public.transactions    enable row level security;
alter table public.sync_logs       enable row level security;

create policy "profiles: own or admin read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
-- Kullanıcı sadece kendi satırını ve sadece username sütununu güncelleyebilir
-- (sütun bazlı grant aşağıda; balance/is_admin sadece RPC ile değişir)
create policy "profiles: own username update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "leagues read"   on public.leagues   for select to authenticated using (true);
create policy "teams read"     on public.teams     for select to authenticated using (true);
create policy "fixtures read"  on public.fixtures  for select to authenticated using (true);
create policy "odds read"      on public.odds      for select to authenticated using (true);
create policy "standings read" on public.standings for select to authenticated using (true);

create policy "bets: own or admin" on public.bets
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "bet_selections: own or admin" on public.bet_selections
  for select to authenticated using (
    exists (select 1 from public.bets b where b.id = bet_id and (b.user_id = auth.uid() or public.is_admin()))
  );
create policy "transactions: own or admin" on public.transactions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "sync_logs: admin" on public.sync_logs
  for select to authenticated using (public.is_admin());

grant usage on schema public to anon, authenticated, service_role;
-- Supabase varsayılan olarak tüm yetkileri verir; yazma yetkilerini geri al
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant update (username) on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.place_bet(jsonb, numeric) to authenticated;
grant execute on function public.admin_adjust_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.settle_pending() to service_role;
grant execute on function public.settle_fixture(bigint) to service_role;

-- ---------------------------------------------------------------------
--  REALTIME
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.fixtures;
alter publication supabase_realtime add table public.odds;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.bets;

-- ---------------------------------------------------------------------
--  ZAMANLAYICI (pg_cron -> Edge Functions)
--  Vault'a şu sırları eklemeniz gerekir (README'ye bakın):
--    select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--    select vault.create_secret('<service_role_key>',        'service_role_key');
-- ---------------------------------------------------------------------
create or replace function public.invoke_edge(p_function text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or v_key is null then
    raise notice 'Vault secrets missing (project_url / service_role_key)';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

select cron.schedule('macoran-sync-live',      '* * * * *',    $$select public.invoke_edge('sync-live')$$);
select cron.schedule('macoran-sync-odds',      '*/10 * * * *', $$select public.invoke_edge('sync-odds')$$);
select cron.schedule('macoran-sync-fixtures',  '5 * * * *',    $$select public.invoke_edge('sync-fixtures')$$);
select cron.schedule('macoran-sync-standings', '20 * * * *',   $$select public.invoke_edge('sync-standings')$$);
