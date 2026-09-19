-- cashed enum bir önceki migration'da eklendi; burada kullanılır
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('grant', 'deduct', 'bet', 'win', 'refund', 'cashout'));

create or replace function public.cash_out_bet(p_bet_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_quote  jsonb;
  v_amount numeric;
  v_bet    public.bets%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_bet from public.bets where id = p_bet_id and user_id = v_uid for update;
  if not found then raise exception 'BET_NOT_FOUND'; end if;
  if v_bet.status <> 'pending' then raise exception 'BET_SETTLED'; end if;

  v_quote := public.cash_out_quote(p_bet_id);
  if coalesce((v_quote ->> 'available')::boolean, false) is not true then
    raise exception '%', coalesce(v_quote ->> 'reason', 'CASHOUT_UNAVAILABLE');
  end if;
  v_amount := (v_quote ->> 'amount')::numeric;

  update public.bet_selections set status = 'void' where bet_id = p_bet_id and status = 'pending';
  update public.bets set status = 'cashed', payout = v_amount, settled_at = now() where id = p_bet_id;
  update public.profiles set balance = balance + v_amount where id = v_uid;
  insert into public.transactions (user_id, amount, type, ref_id, note)
  values (v_uid, v_amount, 'cashout', p_bet_id, 'Kupon bozduruldu');
  perform public.notify_user(v_uid, 'bet_cashout', 'Kupon bozduruldu',
    format('%s ₺ bakiyenize eklendi.', to_char(v_amount, 'FM999999990.00')), p_bet_id);

  return jsonb_build_object('ok', true, 'amount', v_amount, 'balance', (select balance from public.profiles where id = v_uid));
end;
$$;
grant execute on function public.cash_out_bet(uuid) to authenticated;
