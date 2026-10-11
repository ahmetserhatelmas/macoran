-- Bildirim, skor tabelaya yazıldıktan hemen sonra gitsin.
-- Kısa pay, ekranın golü göstermesine yeter; 80 saniye bekletilmez.

create or replace function public.notification_delay(p_type text)
returns interval
language sql immutable
as $$
  select case p_type
    when 'goal' then interval '3 seconds'
    when 'penalty' then interval '3 seconds'
    when 'pen_miss' then interval '3 seconds'
    when 'ft' then interval '3 seconds'
    when 'bet_won' then interval '3 seconds'
    when 'bet_lost' then interval '3 seconds'
    when 'bet_void' then interval '3 seconds'
    when 'ht' then interval '3 seconds'
    when 'kickoff' then interval '3 seconds'
    when 'red' then interval '3 seconds'
    else interval '3 seconds'
  end;
$$;
