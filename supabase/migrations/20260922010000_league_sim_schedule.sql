-- Lig başına maç günü / saat aralığı (TR). stop/start sonrası da kalır.
alter table public.leagues add column if not exists sim_schedule jsonb;

comment on column public.leagues.sim_schedule is
  'Admin takvim: {"days":[1-7],"hour_from":0-23,"hour_to":0-23} Türkiye saati';

drop function if exists public.sim_league_status();

create function public.sim_league_status()
returns table (
  id int, name text, season int, is_active boolean, sim_started_at timestamptz, sim_config jsonb,
  sim_schedule jsonb,
  teams bigint, players bigint, upcoming bigint, played bigint
)
language sql stable security definer set search_path = public
as $$
  select l.id, l.name, l.season, l.is_active, l.sim_started_at, l.sim_config, l.sim_schedule,
         (select count(*) from public.league_teams lt where lt.league_id = l.id) as teams,
         (select count(*) from public.players p where p.team_id in (select lt.team_id from public.league_teams lt where lt.league_id = l.id)) as players,
         (select count(*) from public.fixtures f where f.league_id = l.id and f.is_sim and not f.archived and f.status_short = 'NS') as upcoming,
         (select count(*) from public.fixtures f where f.league_id = l.id and f.is_sim and not f.archived and f.status_short = 'FT') as played
    from public.leagues l
   order by l.sort_order, l.id
$$;

revoke all on function public.sim_league_status() from public, anon, authenticated;
grant execute on function public.sim_league_status() to service_role;
