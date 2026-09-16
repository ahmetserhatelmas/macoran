-- Gol/penaltı anında kupon: askı süresi veya live_odds_at null iken bahis yok
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
  v_locked      boolean;
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

  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_fixture from public.fixtures where id = (v_sel ->> 'fixture_id')::bigint;
    if not found then
      raise exception 'FIXTURE_NOT_FOUND:%', v_sel ->> 'fixture_id';
    end if;

    if v_fixture.id = any (v_fixture_ids) then
      raise exception 'DUPLICATE_FIXTURE:%', v_fixture.id;
    end if;
    v_fixture_ids := array_append(v_fixture_ids, v_fixture.id);

    if not (
      (v_fixture.status_short in ('NS','TBD') and v_fixture.date > now() - interval '3 minutes')
      or v_fixture.status_short = any (v_live_states)
    ) then
      raise exception 'FIXTURE_CLOSED:%', v_fixture.id;
    end if;

    if v_fixture.status_short = any (v_live_states) then
      select exists (
        select 1 from public.sim_matches sm
         where sm.fixture_id = v_fixture.id
           and sm.suspended_until is not null
           and sm.suspended_until > now()
      ) into v_locked;
      if v_locked or v_fixture.live_odds_at is null then
        raise exception 'ODD_SUSPENDED:%', v_fixture.id;
      end if;
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

    if v_fixture.status_short = any (v_live_states) then
      if not v_odd_row.is_live then
        raise exception 'ODD_SUSPENDED:%', v_fixture.id;
      end if;
      if v_fixture.live_odds_at < now() - interval '90 seconds' then
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

  update public.profiles set balance = balance - p_stake where id = v_uid;

  insert into public.bets (user_id, stake, total_odd, potential_win)
  values (v_uid, p_stake, v_total_odd, round(p_stake * v_total_odd, 2))
  returning id into v_bet_id;

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
