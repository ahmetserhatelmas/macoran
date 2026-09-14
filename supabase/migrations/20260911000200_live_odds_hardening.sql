-- Canlı oran sertleştirme + Realtime trafiğini azaltma
--  1) odds: değişmeyen satırların UPDATE'i atlanır (Realtime'a boş mesaj gitmez)
--  2) fixtures.live_odds_at: canlı oranın en son API'den alındığı an (tazelik kontrolü)
--  3) place_bet: ODD_STALE kontrolü fixtures.live_odds_at üzerinden
--  4) sync-live cron'u 15 saniyeye iner; canlı/başlamak üzere maç yoksa dakikada bir çalışır

-- ---------------------------------------------------------------------
-- 1) Değişmeyen oran satırlarını yazma
-- ---------------------------------------------------------------------
create or replace function public.odds_skip_unchanged()
returns trigger
language plpgsql
as $$
begin
  if new.odd = old.odd
     and new.suspended = old.suspended
     and new.is_live = old.is_live
     and new.bookmaker is not distinct from old.bookmaker then
    return null; -- güncelleme yok, trigger/realtime tetiklenmez
  end if;
  return new;
end;
$$;

drop trigger if exists odds_skip_unchanged on public.odds;
create trigger odds_skip_unchanged
  before update on public.odds
  for each row execute function public.odds_skip_unchanged();

-- ---------------------------------------------------------------------
-- 2) Canlı oran tazelik damgası
-- ---------------------------------------------------------------------
alter table public.fixtures add column if not exists live_odds_at timestamptz;

-- ---------------------------------------------------------------------
-- 3) place_bet: tazelik kontrolü live_odds_at ile
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

    -- Canlı maçta: oran canlı olmalı ve son 90 sn içinde API'den doğrulanmış olmalı
    if v_fixture.status_short = any (v_live_states) then
      if not v_odd_row.is_live then
        raise exception 'ODD_SUSPENDED:%', v_fixture.id;
      end if;
      if v_fixture.live_odds_at is null or v_fixture.live_odds_at < now() - interval '90 seconds' then
        raise exception 'ODD_STALE:%', v_fixture.id;
      end if;
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
-- 4) sync-live: 15 saniyede bir; canlı ya da başlamak üzere maç yoksa dakikada bir
-- ---------------------------------------------------------------------
create or replace function public.invoke_live_sync()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_hot boolean;
begin
  select exists (
    select 1 from public.fixtures
     where status_short in ('1H','HT','2H','ET','BT','P','LIVE','INT','SUSP')
        or (status_short in ('NS','TBD') and date between now() - interval '10 minutes' and now() + interval '2 minutes')
  ) into v_hot;

  -- Sıcak dönem değilse sadece dakikanın ilk 15 saniyesindeki tetiklemede çalış
  if v_hot or extract(second from clock_timestamp()) < 15 then
    perform public.invoke_edge('sync-live');
  end if;
end;
$$;

do $$
begin
  perform cron.unschedule('macoran-sync-live');
exception when others then null;
end $$;

select cron.schedule('macoran-sync-live', '15 seconds', $$select public.invoke_live_sync()$$);
