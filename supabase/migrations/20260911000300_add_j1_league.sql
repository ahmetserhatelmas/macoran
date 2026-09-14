-- J1 League (Japonya) eklendi. Sezon 2026-27 (Ağustos-Haziran takvimi) -> API'de 2027.
insert into public.leagues (id, name, country, season, sort_order, logo, flag)
values (98, 'J1 League', 'Japonya', 2027, 21,
        'https://media.api-sports.io/football/leagues/98.png', 'https://media.api-sports.io/flags/jp.svg')
on conflict (id) do update set name = excluded.name, country = excluded.country, season = excluded.season,
  sort_order = excluded.sort_order, logo = excluded.logo, flag = excluded.flag, is_active = true;
