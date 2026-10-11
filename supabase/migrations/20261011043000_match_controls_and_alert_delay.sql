-- Elle girilen kickoff, admin oran kilidi, istatistik kilidi.
-- Gol/kupon bildirimi skor ve sonuç yazıldıktan sonra gitsin.

alter table public.fixtures
  add column if not exists kickoff_locked boolean not null default false;

alter table public.fixtures
  add column if not exists odds_locked boolean not null default false;

alter table public.fixture_details
  add column if not exists stats_locked boolean not null default false;

alter table public.notifications
  add column if not exists deliver_at timestamptz;

alter table public.notifications
  add column if not exists pushed_at timestamptz;

create index if not exists notifications_push_due_idx
  on public.notifications (deliver_at)
  where pushed_at is null and deliver_at is not null;

-- Elle yazılan oran (bookmaker = manual) motor yenilemesinde ezilmesin.
-- Maç askıdaysa (odds_locked) suspended bayrağı da durur.
create or replace function public.replace_fixture_odds(p_fixture_id bigint, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_locked boolean;
begin
  select odds_locked into v_locked from public.fixtures where id = p_fixture_id;

  delete from public.odds o
   where o.fixture_id = p_fixture_id
     and o.bookmaker is distinct from 'manual'
     and not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as i(market text, selection text, line numeric)
        where i.market = o.market and i.selection = o.selection and coalesce(i.line, 0) = o.line
     );

  insert into public.odds (fixture_id, market, selection, line, odd, suspended, is_live, bookmaker, updated_at)
  select p_fixture_id, r.market, r.selection, coalesce(r.line, 0), r.odd, coalesce(r.suspended, false), coalesce(r.is_live, false),
         coalesce(r.bookmaker, 'Macoran'), coalesce(r.updated_at, now())
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as r(market text, selection text, line numeric, odd numeric, suspended boolean, is_live boolean, bookmaker text, updated_at timestamptz)
  on conflict (fixture_id, market, selection, line) do update
    set odd = case when public.odds.bookmaker = 'manual' then public.odds.odd else excluded.odd end,
        suspended = case
          when coalesce(v_locked, false) or public.odds.bookmaker = 'manual' and coalesce(v_locked, false) then public.odds.suspended
          when public.odds.bookmaker = 'manual' then excluded.suspended
          else excluded.suspended
        end,
        is_live = excluded.is_live,
        bookmaker = case when public.odds.bookmaker = 'manual' then public.odds.bookmaker else excluded.bookmaker end,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.notification_delay(p_type text)
returns interval
language sql immutable
as $$
  select case p_type
    when 'goal' then interval '15 seconds'
    when 'penalty' then interval '15 seconds'
    when 'pen_miss' then interval '15 seconds'
    when 'ft' then interval '15 seconds'
    when 'bet_won' then interval '28 seconds'
    when 'bet_lost' then interval '28 seconds'
    when 'bet_void' then interval '28 seconds'
    when 'ht' then interval '10 seconds'
    when 'kickoff' then interval '8 seconds'
    when 'red' then interval '10 seconds'
    else interval '8 seconds'
  end;
$$;

create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text, p_ref_id uuid default null, p_fixture_id bigint default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, ref_id, fixture_id, deliver_at)
  values (p_user_id, p_type, p_title, p_body, p_ref_id, p_fixture_id, now() + public.notification_delay(p_type));
end;
$$;

create or replace function public.notify_fixture_followers(
  p_fixture_id bigint, p_type text, p_title text, p_body text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, fixture_id, deliver_at)
  select distinct u.uid, p_type, p_title, p_body, p_fixture_id, now() + public.notification_delay(p_type)
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

-- Gelecek deliver_at varsa hemen gönderme; flush tick'te yollar.
create or replace function public.enqueue_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  if new.deliver_at is not null and new.deliver_at > now() then
    return new;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or (v_secret is null and v_key is null) then return new; end if;

  perform net.http_post(
    url := v_url || '/functions/v1/push-send',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_secret,
      'Authorization', case when v_key is not null then 'Bearer ' || v_key end
    )),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'title', new.title,
      'body', new.body,
      'type', new.type,
      'ref_id', new.ref_id,
      'fixture_id', new.fixture_id,
      'id', new.id
    ),
    timeout_milliseconds := 8000
  );
  update public.notifications set pushed_at = now() where id = new.id;
  return new;
end;
$$;

create or replace function public.flush_notification_pushes()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r        record;
  n        int := 0;
  v_url    text;
  v_secret text;
  v_key    text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or (v_secret is null and v_key is null) then return 0; end if;

  for r in
    select id, user_id, title, body, type, ref_id, fixture_id
      from public.notifications
     where pushed_at is null
       and deliver_at is not null
       and deliver_at <= now()
     order by deliver_at
     limit 200
     for update skip locked
  loop
    perform net.http_post(
      url := v_url || '/functions/v1/push-send',
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', v_secret,
        'Authorization', case when v_key is not null then 'Bearer ' || v_key end
      )),
      body := jsonb_build_object(
        'user_id', r.user_id,
        'title', r.title,
        'body', r.body,
        'type', r.type,
        'ref_id', r.ref_id,
        'fixture_id', r.fixture_id,
        'id', r.id
      ),
      timeout_milliseconds := 8000
    );
    update public.notifications set pushed_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.flush_notification_pushes() from public, anon, authenticated;
grant execute on function public.flush_notification_pushes() to service_role;
