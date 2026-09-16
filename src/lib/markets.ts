import type { Odd } from '@/types/db';

export const LIVE_STATUSES = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];
export const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];
export const OPEN_STATUSES = ['NS', 'TBD'];

export const isLive = (s: string) => LIVE_STATUSES.includes(s);
export const isFinished = (s: string) => FINISHED_STATUSES.includes(s);
export const isOpen = (s: string) => OPEN_STATUSES.includes(s);
export const canBet = (s: string) => isLive(s) || isOpen(s);

/** Canlıda gol/penaltı kilidi: live_odds_at null iken kupon kabul edilmez. */
export const liveBettingLocked = (status: string, liveOddsAt?: string | null) =>
  isLive(status) && !liveOddsAt;

/** Skorla kesinleşen iki yönlü pazarları gizle (2-0'da 0.5/1.5 Alt kalmasın). */
export function hideDecidedOdds(
  odds: Odd[],
  f: { status_short: string; home_goals: number | null; away_goals: number | null; ht_home?: number | null; ht_away?: number | null },
): Odd[] {
  if (!isLive(f.status_short)) return odds;
  const h = f.home_goals ?? 0, a = f.away_goals ?? 0, g = h + a;
  const h1 = f.ht_home, a1 = f.ht_away;
  const g1 = h1 != null && a1 != null ? h1 + a1 : null;
  return odds.filter((o) => {
    const line = Number(o.line);
    switch (o.market) {
      case 'OU': return g <= line;
      case 'HOU': return h <= line;
      case 'AOU': return a <= line;
      case 'HTOU': return g1 == null || g1 <= line;
      case 'HTHOU': return h1 == null || h1 <= line;
      case 'HTAOU': return a1 == null || a1 <= line;
      case 'BTTS': return !(h > 0 && a > 0);
      case 'HTBTTS': return !(h1 != null && a1 != null && h1 > 0 && a1 > 0);
      default: return true;
    }
  });
}

/** Pazar kodu -> başlık. Sıra, maç detayındaki görüntüleme sırasıdır. */
export const MARKET_LABELS: Record<string, string> = {
  '1X2': 'Maç Sonucu',
  DC: 'Çifte Şans',
  OU: 'Alt/Üst',
  BTTS: 'Karşılıklı Gol',
  AH: 'Handikaplı Maç Sonucu',
  '1X2OU': 'MS ve Alt/Üst',
  '1X2BTTS': 'MS ve Karşılıklı Gol',
  OUBTTS: 'Alt/Üst ve Karşılıklı Gol',
  HTFT: 'İlk Yarı / Maç Sonucu',
  CS: 'Maç Skoru',
  HMG: 'En Çok Gol Olacak Yarı',
  HOU: 'Ev Sahibi Alt/Üst',
  AOU: 'Deplasman Alt/Üst',
  HT1X2: '1. Yarı Sonucu',
  HTDC: '1. Yarı Çifte Şans',
  HTOU: '1. Yarı Alt/Üst',
  HTBTTS: '1. Yarı Karşılıklı Gol',
  HTCS: '1. Yarı Skoru',
  HTHOU: '1. Yarı Ev Sahibi Alt/Üst',
  HTAOU: '1. Yarı Deplasman Alt/Üst',
  '2H1X2': '2. Yarı Sonucu',
  '2HBTTS': '2. Yarı Karşılıklı Gol',
  BHBTTS: '1. Yarı / 2. Yarı Karşılıklı Gol',
  BHU15: 'İki Yarıda da 1,5 Alt',
  BHO15: 'İki Yarıda da 1,5 Üst',
  HWH: 'Ev Sahibi Yarı Kazanır',
  AWH: 'Deplasman Yarı Kazanır',
  HWBH: 'Ev Sahibi İki Yarıyı da Kazanır',
  AWBH: 'Deplasman İki Yarıyı da Kazanır',
  HSBH: 'Ev Sahibi İki Yarıda da Gol Atar',
  ASBH: 'Deplasman İki Yarıda da Gol Atar',
  CORNOU: 'Korner Alt/Üst',
  HTCORNOU: '1. Yarı Korner Alt/Üst',
  PEN: 'Penaltı Olur Mu',
};

export const MARKET_ORDER = Object.keys(MARKET_LABELS);

/** Maç detayındaki pazar filtre sekmeleri */
export const MARKET_CATEGORIES: { key: string; label: string; markets: string[] | null }[] = [
  { key: 'all', label: 'Tümü', markets: null },
  { key: 'main', label: 'Popüler', markets: ['1X2', 'DC', 'OU', 'BTTS', 'AH', 'CS', 'HTFT', '1X2OU'] },
  { key: 'goals', label: 'Gol', markets: ['OU', 'HOU', 'AOU', 'BTTS', 'OUBTTS', 'HMG', 'BHU15', 'BHO15', 'HSBH', 'ASBH', 'CS'] },
  { key: 'ht', label: '1. Yarı', markets: ['HT1X2', 'HTDC', 'HTOU', 'HTBTTS', 'HTCS', 'HTHOU', 'HTAOU', 'HTCORNOU', 'HTFT'] },
  { key: '2h', label: '2. Yarı', markets: ['2H1X2', '2HBTTS', 'BHBTTS', 'HWH', 'AWH', 'HWBH', 'AWBH', 'HMG'] },
  { key: 'combo', label: 'Kombine', markets: ['1X2OU', '1X2BTTS', 'OUBTTS', 'HTFT', 'AH'] },
  { key: 'other', label: 'Korner & Penaltı', markets: ['CORNOU', 'HTCORNOU', 'PEN'] },
];

/** Çizgisi başlıkta gösterilen pazarlar (her çizgi ayrı grup) */
const LINE_MARKETS = new Set(['OU', 'HOU', 'AOU', 'HTOU', 'HTHOU', 'HTAOU', 'CORNOU', 'HTCORNOU', 'AH', '1X2OU', 'OUBTTS']);
export const hasLine = (market: string) => LINE_MARKETS.has(market);

/** Kısa pazar grubu başlığı: "Alt/Üst 2.5", "Handikap (-1)" */
export function marketTitle(market: string, line: number) {
  const base = MARKET_LABELS[market] ?? market;
  if (!hasLine(market)) return base;
  if (market === 'AH') return `${base} (${line > 0 ? '+' : ''}${fmtLine(line)})`;
  return `${base} ${fmtLine(line)}`;
}

export const fmtLine = (line: number) => String(line).replace('.', ',');

const YES_NO = (s: string) => (s === 'YES' ? 'Var' : 'Yok');
const RES = (s: string, home?: string, away?: string) => (s === '1' ? home ?? 'Ev Sahibi' : s === '2' ? away ?? 'Deplasman' : 'Beraberlik');
const RES_SHORT = (s: string) => (s === 'X' ? 'X' : s);
const OU_LABEL = (s: string, line: number) => `${s === 'O' ? 'Üst' : 'Alt'} ${fmtLine(line)}`;
const HALF = (s: string) => (s === '1H' ? '1. Yarı' : s === '2H' ? '2. Yarı' : 'Eşit');

export function selectionLabel(market: string, selection: string, line: number, home?: string, away?: string) {
  switch (market) {
    case '1X2':
    case 'HT1X2':
    case '2H1X2':
      return RES(selection, home, away);
    case 'AH':
      return `${RES(selection, home, away)}`;
    case 'DC':
    case 'HTDC':
      return selection === '1X' ? '1 veya X' : selection === '12' ? '1 veya 2' : 'X veya 2';
    case 'OU':
    case 'HOU':
    case 'AOU':
    case 'HTOU':
    case 'HTHOU':
    case 'HTAOU':
    case 'CORNOU':
    case 'HTCORNOU':
      return OU_LABEL(selection, line);
    case 'BTTS':
    case 'HTBTTS':
    case '2HBTTS':
    case 'BHBTTS':
    case 'BHU15':
    case 'BHO15':
    case 'HWH':
    case 'AWH':
    case 'HWBH':
    case 'AWBH':
    case 'HSBH':
    case 'ASBH':
    case 'PEN':
      return YES_NO(selection);
    case '1X2OU': {
      const r = selection[0];
      const ou = selection.slice(1);
      return `${RES_SHORT(r)} ve ${OU_LABEL(ou, line)}`;
    }
    case '1X2BTTS': {
      const r = selection[0];
      return `${RES_SHORT(r)} ve KG ${YES_NO(selection.slice(1))}`;
    }
    case 'OUBTTS': {
      const ou = selection[0];
      return `${OU_LABEL(ou, line)} ve KG ${YES_NO(selection.slice(1))}`;
    }
    case 'HTFT':
      return selection.replace('/', ' / ');
    case 'CS':
    case 'HTCS':
      return selection === 'OTHER' ? 'Diğer' : selection;
    case 'HMG':
      return HALF(selection);
    default:
      return selection;
  }
}

export function shortSelectionLabel(market: string, selection: string, line: number) {
  switch (market) {
    case '1X2':
    case 'HT1X2':
    case '2H1X2':
      return RES_SHORT(selection);
    case 'AH':
      return `${RES_SHORT(selection)} (${line > 0 ? '+' : ''}${fmtLine(line)})`;
    case 'DC':
    case 'HTDC':
      return selection;
    case 'OU':
    case 'HOU':
    case 'AOU':
    case 'HTOU':
    case 'HTHOU':
    case 'HTAOU':
    case 'CORNOU':
    case 'HTCORNOU':
      return `${selection === 'O' ? 'Ü' : 'A'} ${fmtLine(line)}`;
    case '1X2OU':
      return `${RES_SHORT(selection[0])} & ${selection[1] === 'O' ? 'Ü' : 'A'} ${fmtLine(line)}`;
    case '1X2BTTS':
      return `${RES_SHORT(selection[0])} & KG ${YES_NO(selection.slice(1))}`;
    case 'OUBTTS':
      return `${selection[0] === 'O' ? 'Ü' : 'A'} ${fmtLine(line)} & KG ${YES_NO(selection.slice(1))}`;
    case 'CS':
    case 'HTCS':
      return selection === 'OTHER' ? 'Diğer' : selection;
    case 'HMG':
      return HALF(selection);
    default:
      return selectionLabel(market, selection, line);
  }
}

export function statusLabel(s: string, elapsed: number | null) {
  switch (s) {
    case 'NS': return 'Başlamadı';
    case 'TBD': return 'Belirsiz';
    case '1H': return `${elapsed ?? ''}'`;
    case 'HT': return 'Devre';
    case '2H': return `${elapsed ?? ''}'`;
    case 'ET': return `Uz. ${elapsed ?? ''}'`;
    case 'BT': return 'Uz. Ara';
    case 'P': return 'Penaltılar';
    case 'SUSP': return 'Durduruldu';
    case 'INT': return 'Ara verildi';
    case 'LIVE': return 'Canlı';
    case 'FT': return 'Bitti';
    case 'AET': return 'Uz. Bitti';
    case 'PEN': return 'Pen. Bitti';
    case 'PST': return 'Ertelendi';
    case 'CANC': return 'İptal';
    case 'ABD': return 'Tatil';
    case 'AWD': return 'Hükmen';
    case 'WO': return 'Hükmen';
    default: return s;
  }
}

/** Seçim sıralaması (pazar bazında) */
const SEL_ORDER: Record<string, string[]> = {
  '1X2': ['1', 'X', '2'],
  HT1X2: ['1', 'X', '2'],
  '2H1X2': ['1', 'X', '2'],
  AH: ['1', 'X', '2'],
  DC: ['1X', '12', 'X2'],
  HTDC: ['1X', '12', 'X2'],
  OU: ['O', 'U'], HOU: ['O', 'U'], AOU: ['O', 'U'], HTOU: ['O', 'U'], HTHOU: ['O', 'U'], HTAOU: ['O', 'U'], CORNOU: ['O', 'U'], HTCORNOU: ['O', 'U'],
  BTTS: ['YES', 'NO'], HTBTTS: ['YES', 'NO'], '2HBTTS': ['YES', 'NO'], BHBTTS: ['YES', 'NO'], BHU15: ['YES', 'NO'], BHO15: ['YES', 'NO'],
  HWH: ['YES', 'NO'], AWH: ['YES', 'NO'], HWBH: ['YES', 'NO'], AWBH: ['YES', 'NO'], HSBH: ['YES', 'NO'], ASBH: ['YES', 'NO'], PEN: ['YES', 'NO'],
  '1X2OU': ['1O', '1U', 'XO', 'XU', '2O', '2U'],
  '1X2BTTS': ['1YES', '1NO', 'XYES', 'XNO', '2YES', '2NO'],
  OUBTTS: ['OYES', 'ONO', 'UYES', 'UNO'],
  HTFT: ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'],
  HMG: ['1H', '2H', 'EQ'],
};

function scoreSort(a: string, b: string) {
  if (a === 'OTHER') return 1;
  if (b === 'OTHER') return -1;
  const [ah, aa] = a.split('-').map(Number);
  const [bh, ba] = b.split('-').map(Number);
  // ev sahibi galibiyetleri, beraberlikler, deplasman galibiyetleri; içeride toplam gole göre
  const cls = (h: number, w: number) => (h > w ? 0 : h === w ? 1 : 2);
  return cls(ah, aa) - cls(bh, ba) || ah + aa - (bh + ba) || ah - bh;
}

export interface OddGroup {
  key: string;
  market: string;
  line: number;
  title: string;
  odds: Odd[];
  /** satırda kaç sütun (2/3 ya da skor gibi çok seçenekli pazarlarda 3) */
  columns: number;
}

/** Oranları market(+çizgi) -> [odds] olarak gruplar, sıralar */
export function groupOdds(odds: Odd[]): OddGroup[] {
  const groups = new Map<string, Odd[]>();
  for (const o of odds) {
    const key = hasLine(o.market) ? `${o.market}:${o.line}` : o.market;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const order = (k: string) => {
    const [m, l] = k.split(':');
    const i = MARKET_ORDER.indexOf(m);
    return (i === -1 ? 99 : i) * 1000 + (l ? parseFloat(l) + 100 : 0);
  };
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([key, list]) => {
      const market = key.split(':')[0];
      const so = SEL_ORDER[market];
      if (so) list.sort((a, b) => so.indexOf(a.selection) - so.indexOf(b.selection));
      else if (market === 'CS' || market === 'HTCS') list.sort((a, b) => scoreSort(a.selection, b.selection));
      const line = list[0]?.line ?? 0;
      const n = list.length;
      const columns = n <= 3 ? n : n === 4 ? 2 : 3;
      return { key, market, line, title: marketTitle(market, line), odds: list, columns };
    });
}

export function pick1X2(odds: Odd[]) {
  const m = odds.filter((o) => o.market === '1X2');
  return {
    '1': m.find((o) => o.selection === '1'),
    X: m.find((o) => o.selection === 'X'),
    '2': m.find((o) => o.selection === '2'),
  };
}

export const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Giriş yapmalısınız.',
  MIN_STAKE: 'Minimum bahis tutarı 1 ₺.',
  SELECTION_COUNT: 'Kuponda 1-15 arası seçim olmalı.',
  PROFILE_NOT_FOUND: 'Profil bulunamadı.',
  INSUFFICIENT_BALANCE: 'Bakiyeniz yetersiz.',
  FIXTURE_NOT_FOUND: 'Maç bulunamadı.',
  DUPLICATE_FIXTURE: 'Aynı maçtan birden fazla seçim yapılamaz.',
  FIXTURE_CLOSED: 'Bu maç bahse kapalı.',
  ODD_NOT_FOUND: 'Oran artık mevcut değil.',
  ODD_SUSPENDED: 'Bu oran şu an askıda.',
  ODD_STALE: 'Canlı oran güncelleniyor, lütfen tekrar deneyin.',
  ODDS_CHANGED: 'Oranlar değişti. Kuponunuz güncellendi, tekrar onaylayın.',
  ADMIN_REQUIRED: 'Bu işlem için admin yetkisi gerekir.',
  INVALID_AMOUNT: 'Geçersiz tutar.',
  USER_NOT_FOUND: 'Kullanıcı bulunamadı.',
};

export function humanizeError(message: string | undefined) {
  if (!message) return 'Bir hata oluştu.';
  const code = message.split(':')[0].trim();
  return ERROR_MESSAGES[code] ?? message;
}
