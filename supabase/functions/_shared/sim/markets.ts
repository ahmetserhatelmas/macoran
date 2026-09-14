// Bahis pazarları: seçimler, çizgiler ve sonuç kuralları.
// Aynı `outcome` fonksiyonu hem oran hesaplamada (olasılık toplama) hem de
// maç sonunda kupon sonuçlandırmada kullanılır -> tek doğruluk kaynağı.

export interface Facts {
  h1: number;       // ev sahibi 1. yarı golleri
  a1: number;
  h2: number;       // ev sahibi 2. yarı golleri
  a2: number;
  corners: number;  // toplam korner
  corners1h: number;
  penalty: boolean; // maçta penaltı (atılan ya da kaçan) oldu mu
}

export type MarketKind = "goals" | "corners" | "corners1h" | "penalty";

export interface MarketDef {
  code: string;
  kind: MarketKind;
  /** Sunulan çizgiler (yoksa [0]) */
  lines: number[];
  /** Seçim anahtarları (görüntü sırası) */
  selections: string[] | ((line: number) => string[]);
  /** Kazanan seçim(ler); null -> iade (push) */
  outcome: (f: Facts, line: number) => string | string[] | null;
  /** Çok seçenekli pazarlarda marj çarpanı */
  marginMul?: number;
}

const res = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
const ou = (total: number, line: number) => (total === line ? null : total > line ? "O" : "U");
const dc = (h: number, a: number) => (h > a ? ["1X", "12"] : h < a ? ["12", "X2"] : ["1X", "X2"]);
const yn = (b: boolean) => (b ? "YES" : "NO");
const ft = (f: Facts) => ({ h: f.h1 + f.h2, a: f.a1 + f.a2 });

function csKeys(max: number): string[] {
  const out: string[] = [];
  for (let d = 0; d <= max; d++) out.push(`${d}-${d}`);
  for (let h = 1; h <= max; h++) for (let a = 0; a < h; a++) out.push(`${h}-${a}`);
  for (let a = 1; a <= max; a++) for (let h = 0; h < a; h++) out.push(`${h}-${a}`);
  out.push("OTHER");
  return out;
}
const cs = (h: number, a: number, max: number) => (h <= max && a <= max ? `${h}-${a}` : "OTHER");

export const MARKETS: MarketDef[] = [
  { code: "1X2", kind: "goals", lines: [0], selections: ["1", "X", "2"], outcome: (f) => { const s = ft(f); return res(s.h, s.a); } },
  { code: "DC", kind: "goals", lines: [0], selections: ["1X", "12", "X2"], outcome: (f) => { const s = ft(f); return dc(s.h, s.a); } },
  // Handikaplı MS: çizgi ev sahibine uygulanır (-1 => ev sahibi 1 gol geride başlar)
  { code: "AH", kind: "goals", lines: [-2, -1, 1, 2], selections: ["1", "X", "2"], outcome: (f, line) => { const s = ft(f); return res(s.h + line, s.a); } },
  { code: "CS", kind: "goals", lines: [0], selections: csKeys(3), outcome: (f) => { const s = ft(f); return cs(s.h, s.a, 3); }, marginMul: 2.2 },
  { code: "HTFT", kind: "goals", lines: [0], selections: ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"], outcome: (f) => `${res(f.h1, f.a1)}/${res(ft(f).h, ft(f).a)}`, marginMul: 1.8 },
  { code: "OU", kind: "goals", lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], selections: ["O", "U"], outcome: (f) => ou(ft(f).h + ft(f).a, 0) },
  { code: "1X2OU", kind: "goals", lines: [2.5], selections: ["1O", "1U", "XO", "XU", "2O", "2U"], outcome: (f, line) => { const s = ft(f); const o = ou(s.h + s.a, line); return o ? res(s.h, s.a) + o : null; }, marginMul: 1.5 },
  { code: "1X2BTTS", kind: "goals", lines: [0], selections: ["1YES", "1NO", "XYES", "XNO", "2YES", "2NO"], outcome: (f) => { const s = ft(f); return res(s.h, s.a) + yn(s.h > 0 && s.a > 0); }, marginMul: 1.5 },
  { code: "BTTS", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => { const s = ft(f); return yn(s.h > 0 && s.a > 0); } },
  { code: "HMG", kind: "goals", lines: [0], selections: ["1H", "2H", "EQ"], outcome: (f) => { const g1 = f.h1 + f.a1, g2 = f.h2 + f.a2; return g1 > g2 ? "1H" : g2 > g1 ? "2H" : "EQ"; } },
  { code: "HT1X2", kind: "goals", lines: [0], selections: ["1", "X", "2"], outcome: (f) => res(f.h1, f.a1) },
  { code: "HTCS", kind: "goals", lines: [0], selections: csKeys(2), outcome: (f) => cs(f.h1, f.a1, 2), marginMul: 2 },
  { code: "HTDC", kind: "goals", lines: [0], selections: ["1X", "12", "X2"], outcome: (f) => dc(f.h1, f.a1) },
  { code: "HTOU", kind: "goals", lines: [0.5, 1.5, 2.5], selections: ["O", "U"], outcome: (f) => ou(f.h1 + f.a1, 0) },
  { code: "HTBTTS", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 > 0 && f.a1 > 0) },
  { code: "HTHOU", kind: "goals", lines: [0.5, 1.5], selections: ["O", "U"], outcome: (f) => ou(f.h1, 0) },
  { code: "HTAOU", kind: "goals", lines: [0.5, 1.5], selections: ["O", "U"], outcome: (f) => ou(f.a1, 0) },
  { code: "2H1X2", kind: "goals", lines: [0], selections: ["1", "X", "2"], outcome: (f) => res(f.h2, f.a2) },
  { code: "2HBTTS", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h2 > 0 && f.a2 > 0) },
  { code: "BHBTTS", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 > 0 && f.a1 > 0 && f.h2 > 0 && f.a2 > 0) },
  { code: "BHU15", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 + f.a1 < 1.5 && f.h2 + f.a2 < 1.5) },
  { code: "BHO15", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 + f.a1 > 1.5 && f.h2 + f.a2 > 1.5) },
  { code: "HOU", kind: "goals", lines: [0.5, 1.5, 2.5], selections: ["O", "U"], outcome: (f) => ou(ft(f).h, 0) },
  { code: "AOU", kind: "goals", lines: [0.5, 1.5, 2.5], selections: ["O", "U"], outcome: (f) => ou(ft(f).a, 0) },
  { code: "HWH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 > f.a1 || f.h2 > f.a2) },
  { code: "AWH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.a1 > f.h1 || f.a2 > f.h2) },
  { code: "HWBH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 > f.a1 && f.h2 > f.a2) },
  { code: "AWBH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.a1 > f.h1 && f.a2 > f.h2) },
  { code: "HSBH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.h1 > 0 && f.h2 > 0) },
  { code: "ASBH", kind: "goals", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.a1 > 0 && f.a2 > 0) },
  { code: "CORNOU", kind: "corners", lines: [8.5, 9.5, 10.5, 11.5], selections: ["O", "U"], outcome: (f) => ou(f.corners, 0) },
  { code: "HTCORNOU", kind: "corners1h", lines: [3.5, 4.5, 5.5], selections: ["O", "U"], outcome: (f) => ou(f.corners1h, 0) },
  { code: "PEN", kind: "penalty", lines: [0], selections: ["YES", "NO"], outcome: (f) => yn(f.penalty) },
  { code: "OUBTTS", kind: "goals", lines: [2.5], selections: ["OYES", "ONO", "UYES", "UNO"], outcome: (f, line) => { const s = ft(f); const o = ou(s.h + s.a, line); return o ? o + yn(s.h > 0 && s.a > 0) : null; }, marginMul: 1.3 },
];

// Alt/Üst tipi pazarlarda outcome, çizgiyi kendisi almalı: yukarıda ou(total, 0)
// yazılanlar için çizgi burada uygulanır.
const OU_TOTAL: Record<string, (f: Facts) => number> = {
  OU: (f) => f.h1 + f.h2 + f.a1 + f.a2,
  HTOU: (f) => f.h1 + f.a1,
  HTHOU: (f) => f.h1,
  HTAOU: (f) => f.a1,
  HOU: (f) => f.h1 + f.h2,
  AOU: (f) => f.a1 + f.a2,
  CORNOU: (f) => f.corners,
  HTCORNOU: (f) => f.corners1h,
};

export const MARKET_BY_CODE = new Map(MARKETS.map((m) => [m.code, m]));

export function selectionsOf(m: MarketDef, line: number): string[] {
  return typeof m.selections === "function" ? m.selections(line) : m.selections;
}

/** Kazanan seçimler (null => iade). Çizgi burada uygulanır. */
export function outcome(code: string, f: Facts, line: number): string[] | null | undefined {
  const m = MARKET_BY_CODE.get(code);
  if (!m) return undefined;
  const totalFn = OU_TOTAL[code];
  const w = totalFn ? ou(totalFn(f), line) : m.outcome(f, line);
  if (w === null) return null;
  return Array.isArray(w) ? w : [w];
}

export type SelStatus = "won" | "lost" | "void";

/** Kupon seçimini gerçeklere göre sonuçlandır */
export function settleSelection(code: string, selection: string, line: number, f: Facts): SelStatus {
  const w = outcome(code, f, line);
  if (w === undefined) return "void";      // bilinmeyen pazar -> iade
  if (w === null) return "void";           // push
  return w.includes(selection) ? "won" : "lost";
}
