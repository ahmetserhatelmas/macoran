-- Kupon seçimleri canlıda erken sonuçlanınca istemci hemen güncellensin
do $$
begin
  alter publication supabase_realtime add table public.bet_selections;
exception
  when duplicate_object then null;
end $$;
