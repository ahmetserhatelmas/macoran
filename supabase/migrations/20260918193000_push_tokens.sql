-- Cihaz push token'ları + bildirim satırı düşünce telefona Expo Push

create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
drop policy if exists "push_tokens: own" on public.push_tokens;
create policy "push_tokens: own" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());

grant select on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'INVALID_TOKEN'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'INVALID_PLATFORM'; end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;
grant execute on function public.unregister_push_token(text) to authenticated;

create or replace function public.enqueue_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or v_key is null then return new; end if;

  perform net.http_post(
    url := v_url || '/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
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

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push();
