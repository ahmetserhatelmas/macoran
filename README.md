# Macoran

Sanal para ile futbol iddaa uygulaması. React Native (Expo) + Supabase. Maçlar gerçek liglerin takımlarıyla
**kendi simülasyon motorumuzda** oynanır; oranlar, canlı anlatım, istatistikler, gol/asist krallığı ve puan durumu
tamamen simülasyondan üretilir.

- 30 lig: Süper Lig, 1. Lig, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Şampiyonlar Ligi, Avrupa Ligi, Konferans Ligi, Eredivisie, Primeira Liga, Jupiler Pro League, İskoçya Premiership, Championship, Brezilya Serie A, Arjantin Liga Profesional, MLS, Liga MX, Saudi Pro League, J1 League, Azerbaycan Premyer Liqa, 2. Bundesliga, LaLiga 2, Serie B, Ligue 2, Avusturya Bundesliga, Yunanistan Super League, K League 1, Copa Libertadores
- Takım güçleri (hücum / orta saha / savunma / kaleci) API-Football puan tablolarından türetilir (bu sezon + geçen sezon karışımı); kadrolar API-Football'dan içe aktarılır
- Admin panelinden **Ligi başlat**: fikstür üretilir (çift devreli lig usulü), saat gelince maç motorda oynanır
- Maç öncesi + canlı bahis; gol / kırmızı kart / VAR'da oranlar askıya alınır, sonra yeni oranlar (15 sn tick)
- 34 market: Maç Sonucu, Çifte Şans, Handikap, Maç Skoru, İY/MS, MS+Alt/Üst, MS+KG, KG, En Çok Gol Olan Yarı, 1. Yarı (sonuç, skor, çifte şans, alt/üst, KG, ev/dep alt/üst), 2. Yarı (sonuç, KG), yarı kombinasyonları, ev/dep alt/üst, yarı kazanma marketleri, korner alt/üst, penaltı, Alt/Üst+KG
- Oyuncu bazlı olaylar: gol, asist, kart, sakatlık, ceza; gol krallığı ve asist krallığı tabloları
- Senaryo: admin gelecek bir maçın ilk yarı / maç sonu skorunu yazar, motor senaryoya uygun gerçekçi bir maç üretir
- Tekli ve kombine kupon (en fazla 15 seçim), oran değişikliği uyarısı, otomatik sonuçlandırma
- Admin (`ahmetserhatelmas@gmail.com`) kullanıcılara sanal para yükler/düşer, tüm kullanıcı ve kuponları görür
- Gerçek para yok; bakiye sadece RPC'lerle değişir (RLS + sütun yetkileri ile korunur)

## Çalıştırma

```bash
npm install
npx expo start          # Expo Go ile iOS/Android
npx expo run:ios        # veya native build
npx expo run:android
```

`.env` dosyası Supabase projesinin URL'ini ve anon/publishable anahtarını içerir (`.env.example`'a bakın).

İlk kayıt: uygulamada `ahmetserhatelmas@gmail.com` ile kayıt olun → otomatik admin olur. Profil → Admin Paneli.

## Mimari

```
src/
  app/                 expo-router ekranları
    (auth)/            giriş / kayıt
    (tabs)/            Maçlar · Canlı · Kuponlarım · Puan Durumu (+ Gol / Asist Krallığı) · Profil
    match/[id]         maç detayı: oranlar (kategori sekmeleri), olaylar/anlatım, istatistikler
    betslip            kupon modalı (oran onayı, bahis tutarı) → place_bet RPC
    admin/             kullanıcı listesi, bakiye işlemleri
    admin/sim          simülasyon paneli: motor durumu, hız ayarı, Ligi başlat / Durdur
    admin/scenario/    lig bazında gelecek maçlara senaryo yazma
  components/          UI bileşenleri (OddButton, FixtureCard, BetCard, MatchTimeline, ...)
  lib/                 supabase istemcisi, react-query sorguları, market etiketleri/gruplama, format
  store/               zustand: auth (profil + realtime bakiye), betslip (kalıcı kupon)
supabase/
  migrations/          şema, RLS, RPC (place_bet, sim_settle_fixture, replace_fixture_odds, ...), pg_cron
  functions/           Edge Functions (Deno)
    sim-tick           15 sn: maçları başlat / ilerlet / bitir, canlı + maç öncesi oranlar, sonuçlandırma,
                       oyuncu istatistikleri, puan durumu (tick kilidi ile üst üste binmez)
    sim-admin          admin işlemleri: status, start_league, stop_league, set_scenario, clear_scenario,
                       update_settings, import_squads, init_ratings, set_rating
    usage              API-Football kota/kullanım raporu (web/dashboard.html)
    _shared/sim/       motor: rng, model (güç → λ, 34 market olasılığı, fiyatlama), markets (sonuçlandırma),
                       script (maç senaryosu üretimi), clock, league (fikstür, puan durumu), squads, store
```

### Motor nasıl çalışır

1. **Ligi başlat** → takımlar ve güçler (`team_ratings`), kadrolar (`players`), fikstür (`fixtures.is_sim`) üretilir;
   eski fikstürler arşivlenir ve açık kuponlar iade edilir.
2. Her 15 sn `sim-tick`: saati gelen maç için tohumlu RNG ile **tüm maçın script'i** (olaylar, istatistik zaman
   çizelgesi, kadrolar) üretilir ve `sim_matches`'e yazılır; sonra gerçek saate göre dakika dakika açıklanır
   (`sim_settings.seconds_per_minute`, `halftime_seconds`).
3. Etkin güç = temel güç × simülasyon performansı (sezon ilerledikçe ağırlığı artar) + form. Poisson tabanlı
   ortak dağılımdan 34 marketin olasılığı hesaplanır, marj eklenir, oranlar yazılır. Canlıda kalan süre / skor /
   kırmızı kartla yeniden fiyatlanır; gol/kırmızı/VAR sonrası `goal_suspend_seconds` boyunca askı.
4. Maç bitince `sim_settle_fixture` kuponları sonuçlandırır, `player_stats` güncellenir, sakatlık/ceza işlenir,
   puan durumu yeniden kurulur, ligin maç öncesi oranları yenilenir.

Hız ayarı (admin paneli): gerçek (60 sn/dk), hızlı, çok hızlı, test. API-Football sadece kadro ve puan tablosu
içe aktarımında kullanılır (lig başına birkaç istek).

## Supabase kurulumu (yeni bir projeye taşımak için)

```bash
supabase login
supabase link --project-ref <REF>
supabase db push                                   # migrations/
supabase secrets set --env-file supabase/functions/.env   # API_FOOTBALL_KEY, CRON_SECRET
supabase functions deploy
```

SQL Editor'de vault sırlarını ekleyin (cron'un Edge Function'ları çağırması için):

```sql
select vault.create_secret('https://<REF>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>',        'service_role_key');
select vault.create_secret('<CRON_SECRET ile aynı>',    'cron_secret');
```

Authentication → Providers → Email: "Confirm email" kapatılmalı (ya da SMTP kurulmalı).

Sonra uygulamada Admin → Simülasyon → istediğiniz lig için **Ligi başlat**.

## Sonuçlandırma kuralları

- 90 dakika sonucu esas alınır.
- Alt/Üst'te tam sayı çizgide toplam çizgiye eşitse iade (oran 1.00).
- İptal edilen / lig durdurulduğunda arşivlenen maçlarda seçim iade edilir; kombinede diğer seçimler devam eder.
- Kombinede bir seçim kaybederse kupon kaybeder; hepsi kazanır/iade olursa ödeme = tutar × kazanan oranların çarpımı.

## API kullanım paneli (`web/dashboard.html`)

API-Football istek kotasını, görev bazında tüketimi, saatlik/günlük grafikleri ve hataları gösterir.
Sadece admin hesabıyla giriş yapılabilir; veriyi `usage` Edge Function'ından çeker.

```bash
open web/dashboard.html          # macOS
```
