-- Simülasyon performansı:
--  1) replace_fixture_odds: bir fikstürün tüm oranlarını tek çağrıda değiştir (upsert + listede olmayanları sil)
--  2) sim_tick_lock / sim_tick_unlock: tick'lerin üst üste binmesini engelle

-- 1) Oranları tek seferde değiştir --------------------------------------
create or replace function public.replace_fixture_odds(p_fixture_id bigint, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- Listede olmayanları sil (kesinleşen pazarlar / artık sunulmayan seçimler)
  delete from public.odds o
   where o.fixture_id = p_fixture_id
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
    set odd = excluded.odd, suspended = excluded.suspended, is_live = excluded.is_live,
        bookmaker = excluded.bookmaker, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.replace_fixture_odds(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.replace_fixture_odds(bigint, jsonb) to service_role;

-- 2) Tick kilidi ---------------------------------------------------------
alter table public.sim_settings add column if not exists tick_started_at timestamptz;

create or replace function public.sim_tick_lock(p_ttl_seconds int default 90)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_ok boolean := false;
begin
  update public.sim_settings
     set tick_started_at = now()
   where id = 1
     and (tick_started_at is null or tick_started_at < now() - make_interval(secs => p_ttl_seconds))
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.sim_tick_unlock()
returns void
language sql security definer set search_path = public
as $$
  update public.sim_settings set tick_started_at = null where id = 1;
$$;

revoke all on function public.sim_tick_lock(int) from public, anon, authenticated;
revoke all on function public.sim_tick_unlock() from public, anon, authenticated;
grant execute on function public.sim_tick_lock(int) to service_role;
grant execute on function public.sim_tick_unlock() to service_role;
