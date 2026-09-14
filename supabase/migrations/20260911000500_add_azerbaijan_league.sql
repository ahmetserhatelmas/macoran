-- Azerbaycan Premyer Liqa eklendi (API-Football id 419, sezon 2026).
insert into public.leagues (id, name, country, season, sort_order, logo, flag)
values (419, 'Premyer Liqa', 'Azerbaycan', 2026, 22,
        'https://media.api-sports.io/football/leagues/419.png', 'https://media.api-sports.io/flags/az.svg')
on conflict (id) do update set name = excluded.name, country = excluded.country, season = excluded.season,
  sort_order = excluded.sort_order, logo = excluded.logo, flag = excluded.flag, is_active = true;
