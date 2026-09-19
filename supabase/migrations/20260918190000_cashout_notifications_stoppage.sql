-- Uzatma dakikası, bildirimler, kupon sonuç bildirimi
-- (cashed enum ayrı migration'da kullanılır)

alter table public.fixtures add column if not exists elapsed_extra int;

create or replace function public.fixtures_skip_unchanged()
returns trigger
language plpgsql
as $$
begin
  if new.status_short = old.status_short
     and new.elapsed is not distinct from old.elapsed
     and new.elapsed_extra is not distinct from old.elapsed_extra
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

do $$
begin
  alter type public.bet_status add value if not exists 'cashed';
exception when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null,
  ref_id      uuid,
  fixture_id  bigint references public.fixtures (id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "notifications: own" on public.notifications;
create policy "notifications: own" on public.notifications
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "notifications: own update" on public.notifications;
create policy "notifications: own update" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text, p_ref_id uuid default null, p_fixture_id bigint default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, ref_id, fixture_id)
  values (p_user_id, p_type, p_title, p_body, p_ref_id, p_fixture_id);
end;
$$;
grant execute on function public.notify_user(uuid, text, text, text, uuid, bigint) to service_role;

create or replace function public.notify_fixture_followers(
  p_fixture_id bigint, p_type text, p_title text, p_body text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, fixture_id)
  select distinct b.user_id, p_type, p_title, p_body, p_fixture_id
    from public.bet_selections s
    join public.bets b on b.id = s.bet_id
   where s.fixture_id = p_fixture_id
     and s.status = 'pending'
     and b.status = 'pending';
end;
$$;
grant execute on function public.notify_fixture_followers(bigint, text, text, text) to service_role;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_ids is null then
    update public.notifications set read_at = now()
     where user_id = auth.uid() and read_at is null;
  else
    update public.notifications set read_at = now()
     where user_id = auth.uid() and read_at is null and id = any (p_ids);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

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
    perform public.notify_user(v_bet.user_id, 'bet_lost', 'Kupon kaybetti',
      format('Kuponunuz sonuçlandı. Tutar %s ₺.', to_char(v_bet.stake, 'FM999999990.00')), p_bet_id);
    return;
  end if;

  if v_pending > 0 then return; end if;

  v_odd := round(v_odd, 3);
  v_payout := round(v_bet.stake * v_odd, 2);

  if v_odd = 1 then
    update public.bets set status = 'void', payout = v_payout, settled_at = now() where id = p_bet_id;
    update public.profiles set balance = balance + v_payout where id = v_bet.user_id;
    insert into public.transactions (user_id, amount, type, ref_id, note)
    values (v_bet.user_id, v_payout, 'refund', p_bet_id, 'Kupon iade edildi');
    perform public.notify_user(v_bet.user_id, 'bet_void', 'Kupon iade',
      format('%s ₺ bakiyenize iade edildi.', to_char(v_payout, 'FM999999990.00')), p_bet_id);
  else
    update public.bets set status = 'won', payout = v_payout, settled_at = now() where id = p_bet_id;
    update public.profiles set balance = balance + v_payout where id = v_bet.user_id;
    insert into public.transactions (user_id, amount, type, ref_id, note)
    values (v_bet.user_id, v_payout, 'win', p_bet_id, 'Kupon kazandı');
    perform public.notify_user(v_bet.user_id, 'bet_won', 'Kupon kazandı',
      format('Tebrikler! %s ₺ kazandınız.', to_char(v_payout, 'FM999999990.00')), p_bet_id);
  end if;
end;
$$;

create or replace function public.cash_out_quote(p_bet_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_bet     public.bets%rowtype;
  v_sel     public.bet_selections%rowtype;
  v_odd     numeric;
  v_factor  numeric := 1;
  v_amount  numeric;
  v_locked  boolean;
  v_status  text;
  v_live_at timestamptz;
  v_live    text[] := array['1H','HT','2H','ET','BT','P','LIVE','INT'];
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_bet from public.bets where id = p_bet_id and (user_id = v_uid or public.is_admin());
  if not found then raise exception 'BET_NOT_FOUND'; end if;
  if v_bet.status <> 'pending' then
    return jsonb_build_object('available', false, 'reason', 'BET_SETTLED');
  end if;

  for v_sel in select * from public.bet_selections where bet_id = p_bet_id loop
    if v_sel.status = 'lost' then
      return jsonb_build_object('available', false, 'reason', 'SELECTION_LOST');
    end if;
    if v_sel.status = 'void' then continue; end if;
    if v_sel.status = 'won' then
      v_factor := v_factor * v_sel.odd;
      continue;
    end if;

    select f.status_short, f.live_odds_at into v_status, v_live_at
      from public.fixtures f where f.id = v_sel.fixture_id;
    if v_status = any (v_live) then
      select exists (
        select 1 from public.sim_matches sm
         where sm.fixture_id = v_sel.fixture_id
           and sm.suspended_until is not null
           and sm.suspended_until > now()
      ) into v_locked;
      if v_locked or v_live_at is null then
        return jsonb_build_object('available', false, 'reason', 'ODD_SUSPENDED');
      end if;
    elsif v_status not in ('NS','TBD') then
      return jsonb_build_object('available', false, 'reason', 'FIXTURE_CLOSED');
    end if;

    select o.odd into v_odd
      from public.odds o
     where o.fixture_id = v_sel.fixture_id
       and o.market = v_sel.market
       and o.selection = v_sel.selection
       and o.line = v_sel.line
       and o.suspended = false;
    if v_odd is null or v_odd < 1.01 then
      return jsonb_build_object('available', false, 'reason', 'ODD_NOT_FOUND');
    end if;
    v_factor := v_factor * (v_sel.odd / v_odd);
  end loop;

  v_amount := round(v_bet.stake * v_factor * 0.90, 2);
  if v_amount < 1 then
    return jsonb_build_object('available', false, 'reason', 'CASHOUT_LOW', 'amount', v_amount);
  end if;
  return jsonb_build_object('available', true, 'amount', v_amount);
end;
$$;
grant execute on function public.cash_out_quote(uuid) to authenticated;
