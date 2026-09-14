-- Puan durumu: maç bitince hızlı güncelleme
--  - leagues.standings_dirty_at: sync-live bir maç bittiğinde işaretler
--  - sync-standings "dirty" modu 5 dk'da bir işaretli ligleri çeker
--  - tam çekim saatlik kalır

alter table public.leagues add column if not exists standings_dirty_at timestamptz;

-- invoke_edge: isteğe bağlı gövde (eski tek parametreli imza kaldırılır; iki overload çakışıyor)
drop function if exists public.invoke_edge(text);
create or replace function public.invoke_edge(p_function text, p_body jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
  v_key    text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or (v_secret is null and v_key is null) then
    raise notice 'Vault secrets missing (project_url / cron_secret)';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/' || p_function,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_secret,
      'Authorization', case when v_key is not null then 'Bearer ' || v_key end
    )),
    body    := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 120000
  );
end;
$$;

do $$
begin
  perform cron.unschedule('macoran-sync-standings');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('macoran-sync-standings-dirty');
exception when others then null;
end $$;

select cron.schedule('macoran-sync-standings',       '20 * * * *'    , $$select public.invoke_edge('sync-standings')$$);
select cron.schedule('macoran-sync-standings-dirty', '*/5 * * * *',  $$select public.invoke_edge('sync-standings', '{"mode":"dirty"}'::jsonb)$$);
