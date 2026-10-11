-- Gol haberi skor ekrana düştükten, kupon haberi sonuç satırı yazıldıktan sonra gitsin.
-- Liste yenilemesi: fikstür 15 sn, kupon 30 sn. Gecikme en az iki turu kapsar.

create or replace function public.notification_delay(p_type text)
returns interval
language sql immutable
as $$
  select case p_type
    when 'goal' then interval '50 seconds'
    when 'penalty' then interval '50 seconds'
    when 'pen_miss' then interval '50 seconds'
    when 'ft' then interval '50 seconds'
    when 'bet_won' then interval '80 seconds'
    when 'bet_lost' then interval '80 seconds'
    when 'bet_void' then interval '80 seconds'
    when 'ht' then interval '25 seconds'
    when 'kickoff' then interval '20 seconds'
    when 'red' then interval '25 seconds'
    else interval '20 seconds'
  end;
$$;
