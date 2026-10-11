import type { FixtureEvent } from '@/lib/queries';

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick(seed: string, options: string[], used: Set<string>) {
  if (!options.length) return '';
  const start = hash(seed) % options.length;
  for (let i = 0; i < options.length; i++) {
    const s = options[(start + i) % options.length];
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
  return options[start];
}

function who(e: FixtureEvent) {
  return e.player?.name ?? 'Oyuncu';
}

type GoalShape = 'open' | 'level' | 'turn' | 'cut' | 'pad' | 'lead';

function goalShape(score: string | undefined, home: boolean): GoalShape {
  const m = /^(\d+)-(\d+)$/.exec(score ?? '');
  if (!m) return 'lead';
  const h = Number(m[1]);
  const a = Number(m[2]);
  const mine = home ? h : a;
  const opp = home ? a : h;
  const before = mine - 1;
  if (mine === 1 && opp === 0) return 'open';
  if (mine === opp) return 'level';
  if (before < opp && mine > opp) return 'turn';
  if (mine < opp) return 'cut';
  if (mine >= opp + 2) return 'pad';
  return 'lead';
}

function goalLine(e: FixtureEvent, kind: string, score: string | undefined, home: boolean, used: Set<string>) {
  const p = who(e);
  const team = e.team.name;
  const assist = e.assist?.name;
  const minute = e.time.elapsed;
  const late = (e.time.extra ?? 0) > 0 || minute >= 85;
  const shape = goalShape(score, home);
  const seed = `${e.team.id}:${minute}:${e.time.extra ?? 0}:${p}:${kind}`;
  const shells: Record<GoalShape, string[]> = {
    open: [
      `${p} maçın ilk golünü atıyor, ${team} öne geçiyor`,
      `Açılış ${p}'dan. ${team} 1-0'ı buluyor`,
      `${p} sessizliği bozuyor`,
      `İlk tehlikeli anda ${p} ağları buluyor`,
    ],
    level: [
      `${p} eşitliği yakalıyor`,
      `${team} ${p} ile skoru dengeye getiriyor`,
      `Beraberlik golü: ${p}`,
      `${p} farkı siliyor`,
    ],
    turn: [
      `${p} maçı çeviriyor, ${team} öne geçiyor`,
      `Geriye düşen ${team}, ${p} ile öne geçiyor`,
      `${p} skoru tersine döndürüyor`,
    ],
    cut: [
      `${p} farkı indiriyor`,
      `${team} ${p} ile yeniden umutlanıyor`,
      `${p} golü buluyor ama ${team} hâlâ geride`,
    ],
    pad: [
      `${p} farkı açıyor`,
      `${team} ${p} ile skoru soğutuyor`,
      `Rahatlatan gol ${p}'dan`,
    ],
    lead: [
      `${p} ${team}'i öne geçiriyor`,
      `${team} adına ${p} skoru değiştiriyor`,
      `${p} üstünlüğü getiriyor`,
    ],
  };
  const methods = [
    assist ? `${assist} pasından` : 'kendi çabasıyla',
    minute <= 15 ? 'erken bir anda' : late ? 'geç bir anda' : 'organize bir atakta',
    e.comments && /kafa/i.test(e.comments) ? 'kafayla' : '',
    e.comments && /kontratak|geçiş/i.test(e.comments) ? 'kontratakta' : '',
    e.comments && /uzaktan|dışından/i.test(e.comments) ? 'ceza sahası dışından' : '',
    e.comments && /plase/i.test(e.comments) ? 'plase bir vuruşla' : '',
    e.comments && /korner|duran/i.test(e.comments) ? 'duran topta' : '',
    e.comments && /kanat/i.test(e.comments) ? 'kanattan içeri kat ederek' : '',
  ].filter(Boolean);
  const shell = pick(seed, late ? [...shells[shape], `${p} maçın geç bölümünde ağları buluyor`] : shells[shape], used);
  const method = methods.length ? pick(seed + ':m', methods, used) : '';
  const assistBit = assist && !method.includes(assist) ? ` Asist ${assist}.` : '';
  return `GOL! ${shell}${method ? `, ${method}` : ''}.${assistBit}${score ? ` Skor ${score}.` : ''}`;
}

function playLine(e: FixtureEvent, kind: string, used: Set<string>) {
  const p = who(e);
  const team = e.team.name;
  const seed = `${kind}:${e.team.id}:${e.time.elapsed}:${e.time.extra ?? 0}:${p}`;
  const banks: Record<string, string[]> = {
    corner: [
      `${p} korner kazandırıyor`,
      `Köşe vuruşu ${team} lehine. ${p} kullanacak`,
      `${p} çizgiye kadar inip korner çıkarıyor`,
      `Korner: ${p} içeri çeviriyor, savunma uzaklaştırıyor`,
      `${team} duran top kazandı, ${p} topun başında`,
    ],
    foul: [
      `${p} rakibini kesiyor, faul`,
      `Hakem ${p} için düdüğü çalıyor`,
      `${p} geç müdahale ediyor`,
      `Orta sahada itişme, faul ${p}'da`,
      `${p} topa değil adama gidiyor`,
    ],
    throwin: [
      `Taç ${p}'da`,
      `${p} tacı kısa kullanıyor`,
      `${p} kenardan uzun taç atıyor`,
      `Top çizgiyi geçti, taç ${team} lehine`,
    ],
    offside: [
      `${p} ofsayt pozisyonunda yakalanıyor`,
      `Bayrak kalkıyor, ${p} erken çıkmış`,
      `${p} pasın önünde kalıyor`,
      `Ofsayt: ${p} hareketi erken yapıyor`,
    ],
    goalkick: [
      `${p} kale vuruşunu kullanıyor`,
      `${p} oyunu tabandan kuruyor`,
      `Kaleci vuruşu, ${p} uzun top atıyor`,
    ],
    save: [
      `${p} vuruyor, kaleci çıkarıyor`,
      `Yakın şut ${p}'dan, kurtarış var`,
      `${p} köşeyi deniyor, kaleci uzanıyor`,
      `${p} plase çekiyor, kaleci doğru köşede`,
      `Tehlikeli şut: ${p}. Top kornere gidiyor`,
    ],
    woodwork: [
      `Direk! ${p} vuruyor, top dışarı`,
      `${p} şutu direkten dönüyor`,
      `${p} üst direği titretiyor`,
      `Kaçan gol: ${p} direği geçemiyor`,
    ],
    chance: [
      `${p} net pozisyonu kullanamıyor`,
      `${p} boş kale önünde topu dışarı atıyor`,
      `Bire birde ${p} aşıramıyor`,
      `${p} ceza sahasında topu kontrol edemiyor`,
      `${p} son vuruşu yapamadan top kapılıyor`,
    ],
    attack: [
      `${p} ceza sahasına iniyor, savunma araya giriyor`,
      `${p} kanattan bindiriyor, orta kesiliyor`,
      `${team} ${p} ile çıkıyor, şut bloke`,
      `${p} ceza yayına kadar geliyor`,
      `Hızlı hücum: ${p} içeri kat ediyor, faul yok`,
    ],
    stoppage: [
      e.comments ?? 'Hakem uzatma gösterdi',
    ],
  };
  const bank = banks[kind];
  if (!bank) return e.comments ? `${e.comments}.` : `${p} (${team})`;
  const line = pick(seed, bank, used);
  return line.endsWith('.') ? line : `${line}.`;
}

export function narrateMatchEvent(
  e: FixtureEvent,
  kind: string,
  score: string | undefined,
  home: boolean,
  used: Set<string>,
): string {
  const p = who(e);
  const team = e.team.name;
  if (kind === 'goal') return goalLine(e, kind, score, home, used);
  if (kind === 'pen') {
    const line = pick(`${e.time.elapsed}:pen:${p}`, [
      `${p} penaltıyı gole çeviriyor`,
      `${p} noktadan köşeye bırakıyor`,
      `Penaltı golü: ${p}`,
      `${team} penaltıdan skoru değiştiriyor, vuran ${p}`,
    ], used);
    return `GOL! ${line}.${score ? ` Skor ${score}.` : ''}`;
  }
  if (kind === 'penaward') {
    return `PENALTI! ${p !== 'Oyuncu' ? `${p}, ${team} lehine` : team} penaltı kazandı. Atış bekleniyor.`;
  }
  if (kind === 'own') return `Kendi kalesine! ${p} (${team}) topu ağlarına gönderiyor.${score ? ` Skor ${score}.` : ''}`;
  if (kind === 'missed') {
    const line = pick(`${e.time.elapsed}:miss:${p}`, [
      `${p} penaltıyı kaçırıyor`,
      `Kaleci ${p}'ın penaltısını çıkarıyor`,
      `${p} noktadan dışarı vuruyor`,
    ], used);
    return `Penaltı kaçtı! ${line}.`;
  }
  if (kind === 'injury') return `Sakatlık: ${p} (${team}) oyuna devam edemiyor.`;
  if (kind === 'yellow') return `Sarı kart: ${p} (${team}).`;
  if (kind === 'red') {
    return e.detail?.toLowerCase().includes('second')
      ? `İkinci sarıdan kırmızı! ${p} (${team}) oyun dışı.`
      : `Kırmızı kart! ${p} (${team}) oyun dışı kalıyor.`;
  }
  if (kind === 'sub') {
    const inn = e.assist?.name;
    return inn ? `Değişiklik (${team}): ${p} çıkıyor, ${inn} giriyor.` : `Değişiklik (${team}): ${p} çıkıyor.`;
  }
  if (kind === 'var') return `VAR: ${e.comments || e.detail || 'pozisyon inceleniyor'} (${team}).`;
  if (kind === 'corner' || kind === 'foul' || kind === 'throwin' || kind === 'offside' || kind === 'goalkick' || kind === 'save' || kind === 'woodwork' || kind === 'chance' || kind === 'attack' || kind === 'stoppage') {
    return playLine(e, kind, used);
  }
  return e.comments ? `${e.comments}.` : `${e.detail ?? 'Olay'} — ${p} (${team})`;
}
