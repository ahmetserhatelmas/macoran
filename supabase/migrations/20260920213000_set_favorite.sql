-- Favori yıldızı RPC ile kesin yazılsın; hydrate yarışı yüzünden sadece telefonda kalmasın

create or replace function public.set_favorite(p_fixture_id bigint, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_fixture_id is null or p_fixture_id <= 0 then raise exception 'INVALID_FIXTURE'; end if;
  if p_on then
    insert into public.favorite_fixtures (user_id, fixture_id)
    values (auth.uid(), p_fixture_id)
    on conflict do nothing;
  else
    delete from public.favorite_fixtures
     where user_id = auth.uid() and fixture_id = p_fixture_id;
  end if;
end;
$$;
grant execute on function public.set_favorite(bigint, boolean) to authenticated;
