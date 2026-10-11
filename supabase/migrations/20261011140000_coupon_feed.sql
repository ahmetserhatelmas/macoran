-- Kupon akışı: oynanmış kupon paylaşılır, başkası görür, beğenir, yorumlar, kupona alır.
-- Bakiye ve e-posta açılmaz. Tutar yalnızca paylaşan isterse görünür.

create table if not exists public.shared_coupons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  bet_id      uuid not null unique references public.bets (id) on delete cascade,
  note        text,
  show_stake  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint shared_coupons_note_len check (note is null or char_length(note) <= 160)
);
create index if not exists shared_coupons_created_idx on public.shared_coupons (created_at desc);
create index if not exists shared_coupons_user_idx on public.shared_coupons (user_id, created_at desc);

create table if not exists public.shared_coupon_likes (
  coupon_id   uuid not null references public.shared_coupons (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (coupon_id, user_id)
);

create table if not exists public.shared_coupon_comments (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.shared_coupons (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint shared_coupon_comments_body_len check (char_length(body) between 1 and 200)
);
create index if not exists shared_coupon_comments_coupon_idx
  on public.shared_coupon_comments (coupon_id, created_at desc);

alter table public.shared_coupons enable row level security;
alter table public.shared_coupon_likes enable row level security;
alter table public.shared_coupon_comments enable row level security;

drop policy if exists "shared coupons read" on public.shared_coupons;
create policy "shared coupons read" on public.shared_coupons
  for select to authenticated using (true);
drop policy if exists "shared likes read" on public.shared_coupon_likes;
create policy "shared likes read" on public.shared_coupon_likes
  for select to authenticated using (true);
drop policy if exists "shared comments read" on public.shared_coupon_comments;
create policy "shared comments read" on public.shared_coupon_comments
  for select to authenticated using (true);

revoke insert, update, delete on public.shared_coupons from anon, authenticated;
revoke insert, update, delete on public.shared_coupon_likes from anon, authenticated;
revoke insert, update, delete on public.shared_coupon_comments from anon, authenticated;
grant select on public.shared_coupons to authenticated;
grant select on public.shared_coupon_likes to authenticated;
grant select on public.shared_coupon_comments to authenticated;
grant all on public.shared_coupons to service_role;
grant all on public.shared_coupon_likes to service_role;
grant all on public.shared_coupon_comments to service_role;

create or replace function public.share_coupon(p_bet_id uuid, p_note text default null, p_show_stake boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_note is not null and char_length(v_note) > 160 then raise exception 'NOTE_TOO_LONG'; end if;
  if not exists (select 1 from public.bets where id = p_bet_id and user_id = v_uid) then
    raise exception 'BET_NOT_FOUND';
  end if;
  insert into public.shared_coupons (user_id, bet_id, note, show_stake)
  values (v_uid, p_bet_id, v_note, coalesce(p_show_stake, false))
  on conflict (bet_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'ALREADY_SHARED'; end if;
  return v_id;
end;
$$;

create or replace function public.unshare_coupon(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.shared_coupons where bet_id = p_bet_id and user_id = v_uid;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

create or replace function public.toggle_coupon_like(p_coupon_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.shared_coupons where id = p_coupon_id) then
    raise exception 'NOT_FOUND';
  end if;
  delete from public.shared_coupon_likes where coupon_id = p_coupon_id and user_id = v_uid;
  if found then return false; end if;
  insert into public.shared_coupon_likes (coupon_id, user_id) values (p_coupon_id, v_uid);
  return true;
end;
$$;

create or replace function public.comment_coupon(p_coupon_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_body) < 1 then raise exception 'COMMENT_EMPTY'; end if;
  if char_length(v_body) > 200 then raise exception 'COMMENT_TOO_LONG'; end if;
  if not exists (select 1 from public.shared_coupons where id = p_coupon_id) then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.shared_coupon_comments (coupon_id, user_id, body)
  values (p_coupon_id, v_uid, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_coupon_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.shared_coupon_comments where id = p_comment_id and user_id = v_uid;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

create or replace function public.coupon_feed(p_filter text default 'latest', p_limit int default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_filter text := case when p_filter in ('hot', 'mine') then p_filter else 'latest' end;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'bet_id', s.bet_id,
        'user_id', s.user_id,
        'username', s.username,
        'mine', s.user_id = v_uid,
        'note', s.note,
        'show_stake', s.show_stake,
        'stake', case when s.show_stake or s.user_id = v_uid then s.stake else null end,
        'total_odd', s.total_odd,
        'potential_win', case when s.show_stake or s.user_id = v_uid then s.potential_win else null end,
        'status', s.status,
        'created_at', s.created_at,
        'like_count', s.like_count,
        'liked', s.liked,
        'comment_count', s.comment_count,
        'comments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id,
            'body', c.body,
            'created_at', c.created_at,
            'username', coalesce(cp.username, 'Oyuncu'),
            'mine', c.user_id = v_uid
          ) order by c.created_at), '[]'::jsonb)
          from (
            select * from public.shared_coupon_comments
            where coupon_id = s.id
            order by created_at desc
            limit 3
          ) c
          join public.profiles cp on cp.id = c.user_id
        ),
        'selections', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'fixture_id', bs.fixture_id,
            'market', bs.market,
            'selection', bs.selection,
            'line', bs.line,
            'odd', bs.odd,
            'is_live', bs.is_live,
            'home_name', bs.home_name,
            'away_name', bs.away_name,
            'league_name', bs.league_name,
            'fixture_date', bs.fixture_date,
            'status', bs.status,
            'result_home', bs.result_home,
            'result_away', bs.result_away,
            'fixture_status', f.status_short
          ) order by bs.fixture_date nulls last), '[]'::jsonb)
          from public.bet_selections bs
          left join public.fixtures f on f.id = bs.fixture_id
          where bs.bet_id = s.bet_id
        )
      )
      order by case when v_filter = 'hot' then s.like_count else 0 end desc, s.created_at desc
    ), '[]'::jsonb)
    from (
      select
        sc.id, sc.bet_id, sc.user_id, sc.note, sc.show_stake, sc.created_at,
        coalesce(p.username, 'Oyuncu') as username,
        bt.status, bt.total_odd, bt.stake, bt.potential_win,
        (select count(*)::int from public.shared_coupon_likes l where l.coupon_id = sc.id) as like_count,
        exists (
          select 1 from public.shared_coupon_likes l where l.coupon_id = sc.id and l.user_id = v_uid
        ) as liked,
        (select count(*)::int from public.shared_coupon_comments c where c.coupon_id = sc.id) as comment_count
      from public.shared_coupons sc
      join public.bets bt on bt.id = sc.bet_id
      join public.profiles p on p.id = sc.user_id
      where v_filter <> 'mine' or sc.user_id = v_uid
      order by
        case when v_filter = 'hot' then (select count(*) from public.shared_coupon_likes l where l.coupon_id = sc.id) else 0 end desc,
        sc.created_at desc
      limit v_limit
    ) s
  );
end;
$$;

revoke all on function public.share_coupon(uuid, text, boolean) from public, anon;
revoke all on function public.unshare_coupon(uuid) from public, anon;
revoke all on function public.toggle_coupon_like(uuid) from public, anon;
revoke all on function public.comment_coupon(uuid, text) from public, anon;
revoke all on function public.delete_coupon_comment(uuid) from public, anon;
revoke all on function public.coupon_feed(text, int) from public, anon;
grant execute on function public.share_coupon(uuid, text, boolean) to authenticated;
grant execute on function public.unshare_coupon(uuid) to authenticated;
grant execute on function public.toggle_coupon_like(uuid) to authenticated;
grant execute on function public.comment_coupon(uuid, text) to authenticated;
grant execute on function public.delete_coupon_comment(uuid) to authenticated;
grant execute on function public.coupon_feed(text, int) to authenticated;
