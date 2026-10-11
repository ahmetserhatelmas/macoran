-- Süreli ve kalıcı hesap banı. Süre dolunca is_banned kendiliğinden false olur.

alter table public.profiles
  add column if not exists ban_permanent boolean not null default false;

alter table public.profiles
  add column if not exists ban_until timestamptz;

create or replace function public.is_banned(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.ban_permanent or (p.ban_until is not null and p.ban_until > now())
      from public.profiles p
     where p.id = p_user
  ), false);
$$;

create or replace function public.admin_set_ban(
  p_user_id uuid,
  p_mode text,
  p_until timestamptz default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'CANNOT_BAN_SELF';
  end if;
  select is_admin into v_admin from public.profiles where id = p_user_id;
  if v_admin then
    raise exception 'CANNOT_BAN_ADMIN';
  end if;

  if p_mode = 'clear' then
    update public.profiles set ban_permanent = false, ban_until = null where id = p_user_id;
    return;
  end if;

  if p_mode = 'permanent' then
    update public.profiles set ban_permanent = true, ban_until = null where id = p_user_id;
    return;
  end if;

  if p_mode = 'temporary' then
    if p_until is null or p_until <= now() then
      raise exception 'BAN_UNTIL_PAST';
    end if;
    if p_until > now() + interval '2 years' then
      raise exception 'BAN_TOO_LONG';
    end if;
    update public.profiles set ban_permanent = false, ban_until = p_until where id = p_user_id;
    return;
  end if;

  raise exception 'INVALID_BAN';
end;
$$;

revoke all on function public.admin_set_ban(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_set_ban(uuid, text, timestamptz) to authenticated;
grant execute on function public.is_banned(uuid) to authenticated;

-- Banlı hesap kupon basamaz, bozduramaz, paylaşamaz, yorum yazamaz.
create or replace function public.reject_if_banned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and public.is_banned(auth.uid()) then
    raise exception 'ACCOUNT_BANNED';
  end if;
  return new;
end;
$$;

drop trigger if exists bets_reject_banned on public.bets;
create trigger bets_reject_banned
  before insert on public.bets
  for each row execute function public.reject_if_banned();

drop trigger if exists profiles_reject_banned on public.profiles;
create trigger profiles_reject_banned
  before update on public.profiles
  for each row execute function public.reject_if_banned();

drop trigger if exists shared_coupons_reject_banned on public.shared_coupons;
create trigger shared_coupons_reject_banned
  before insert on public.shared_coupons
  for each row execute function public.reject_if_banned();

drop trigger if exists shared_likes_reject_banned on public.shared_coupon_likes;
create trigger shared_likes_reject_banned
  before insert on public.shared_coupon_likes
  for each row execute function public.reject_if_banned();

drop trigger if exists shared_comments_reject_banned on public.shared_coupon_comments;
create trigger shared_comments_reject_banned
  before insert on public.shared_coupon_comments
  for each row execute function public.reject_if_banned();
