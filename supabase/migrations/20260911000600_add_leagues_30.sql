-- 8 yeni lig -> toplam 30. (UEFA Uluslar Ligi'nde oran kapsamı olmadığı için eklenmedi.)
insert into public.leagues (id, name, country, season, sort_order, logo, flag) values
  (79,  '2. Bundesliga',      'Almanya',     2026, 23, 'https://media.api-sports.io/football/leagues/79.png',  'https://media.api-sports.io/flags/de.svg'),
  (141, 'LaLiga 2',           'İspanya',     2026, 24, 'https://media.api-sports.io/football/leagues/141.png', 'https://media.api-sports.io/flags/es.svg'),
  (136, 'Serie B',            'İtalya',      2026, 25, 'https://media.api-sports.io/football/leagues/136.png', 'https://media.api-sports.io/flags/it.svg'),
  (62,  'Ligue 2',            'Fransa',      2026, 26, 'https://media.api-sports.io/football/leagues/62.png',  'https://media.api-sports.io/flags/fr.svg'),
  (218, 'Avusturya Bundesliga','Avusturya',  2026, 27, 'https://media.api-sports.io/football/leagues/218.png', 'https://media.api-sports.io/flags/at.svg'),
  (197, 'Yunanistan Super League','Yunanistan',2026, 28, 'https://media.api-sports.io/football/leagues/197.png', 'https://media.api-sports.io/flags/gr.svg'),
  (292, 'K League 1',         'Güney Kore',  2026, 29, 'https://media.api-sports.io/football/leagues/292.png', 'https://media.api-sports.io/flags/kr.svg'),
  (13,  'Copa Libertadores',  'Güney Amerika',2026, 30, 'https://media.api-sports.io/football/leagues/13.png',  null)
on conflict (id) do update set name = excluded.name, country = excluded.country, season = excluded.season,
  sort_order = excluded.sort_order, logo = excluded.logo, flag = excluded.flag, is_active = true;
