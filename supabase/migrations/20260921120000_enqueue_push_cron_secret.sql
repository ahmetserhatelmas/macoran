-- Telefona giden push 401 oluyordu: vault service_role_key edge'deki
-- SUPABASE_SERVICE_ROLE_KEY ile uyuşmuyor. sim-tick'in kullandığı cron_secret
-- ile aynı başlığı gönder.

create or replace function public.enqueue_push()
returns trigger
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
  return new;
end;
$$;
