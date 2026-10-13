-- Toplam da kâr değil: kazanılan ödemelerin sırası. Kayıp listesi eksi kâr olarak kalır.

create or replace function public.coupon_ranks(p_board text default 'week', p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 50);
  v_from timestamptz;
  v_loss boolean := p_board = 'loss';
  v_gross boolean := p_board in ('day', 'week', 'total');
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_board not in ('day', 'week', 'total', 'loss', 'coupon') then
    raise exception 'INVALID_BOARD';
  end if;

  if p_board = 'day' then
    v_from := (date_trunc('day', now() at time zone 'Europe/Istanbul')) at time zone 'Europe/Istanbul';
  elsif p_board = 'week' then
    v_from := (date_trunc('week', now() at time zone 'Europe/Istanbul')) at time zone 'Europe/Istanbul';
  end if;

  if p_board = 'coupon' then
    return (
      select coalesce(jsonb_agg(x.obj order by x.rnk), '[]'::jsonb)
      from (
        select
          jsonb_build_object(
            'rank', s.rnk,
            'username', s.username,
            'profit', s.win,
            'mine', s.user_id = v_uid
          ) as obj,
          s.rnk
        from (
          select
            b.user_id,
            coalesce(p.username, 'Oyuncu') as username,
            round(coalesce(b.payout, 0), 2) as win,
            row_number() over (order by coalesce(b.payout, 0) desc, b.settled_at asc) as rnk
          from public.bets b
          join public.profiles p on p.id = b.user_id
          where b.status in ('won', 'cashed')
            and coalesce(b.payout, 0) > 0
        ) s
        where s.rnk <= v_limit
      ) x
    );
  end if;

  return (
    with nets as (
      select
        b.user_id,
        coalesce(p.username, 'Oyuncu') as username,
        round(sum(
          case
            when v_gross then coalesce(b.payout, 0)
            when b.status = 'lost' then -b.stake
            else coalesce(b.payout, 0) - b.stake
          end
        ), 2) as profit
      from public.bets b
      join public.profiles p on p.id = b.user_id
      where (
          (v_gross and b.status in ('won', 'cashed'))
          or (not v_gross and b.status in ('won', 'lost', 'cashed'))
        )
        and (v_from is null or coalesce(b.settled_at, b.created_at) >= v_from)
      group by b.user_id, p.username
    ),
    ranked as (
      select
        user_id,
        username,
        profit,
        row_number() over (
          order by
            case when v_loss then profit end asc,
            case when not v_loss then profit end desc,
            username
        ) as rnk
      from nets
      where case when v_loss then profit < 0 else profit > 0 end
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rank', rnk,
        'username', username,
        'profit', profit,
        'mine', user_id = v_uid
      ) order by rnk
    ), '[]'::jsonb)
    from (
      select * from ranked where rnk <= v_limit
      union all
      select * from ranked where user_id = v_uid and rnk > v_limit
    ) q
  );
end;
$$;
