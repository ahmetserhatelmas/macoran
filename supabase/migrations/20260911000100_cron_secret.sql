-- pg_cron -> Edge Function çağrılarında paylaşılan sır kullan.
-- Vault: select vault.create_secret('<rastgele-uzun-değer>', 'cron_secret');
-- Edge Function secrets: CRON_SECRET=<aynı değer>

create or replace function public.invoke_edge(p_function text)
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
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
