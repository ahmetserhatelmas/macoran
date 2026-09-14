-- API döneminden kalan (simülasyon dışı) fikstürler arşive:
--  * açık kupon seçimleri iade (void), kuponlar yeniden hesaplanır
--  * bitmemiş maçlar CANC, hepsi archived = true
--  * oranları ve detayları silinir
-- Ligler admin panelinden "Ligi başlat" ile tek tek simülasyona alınır.
do $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from public.fixtures where is_sim = false and archived = false;
  if v_ids is null then
    return;
  end if;

  perform public.void_fixture_bets(v_ids);

  update public.fixtures
     set archived     = true,
         settled      = true,
         live_odds_at = null,
         status_short = case when status_short in ('FT','AET','PEN') then status_short else 'CANC' end,
         status_long  = case when status_short in ('FT','AET','PEN') then status_long  else 'Cancelled' end
   where id = any (v_ids);

  delete from public.odds where fixture_id = any (v_ids);
  delete from public.fixture_details where fixture_id = any (v_ids);
end;
$$;

-- Başlatılmamış liglerin API puan durumu da temizlenir (uygulama "lig başlatılmadı" gösterir)
delete from public.standings s
 where not exists (select 1 from public.leagues l where l.id = s.league_id and l.sim_started_at is not null);
