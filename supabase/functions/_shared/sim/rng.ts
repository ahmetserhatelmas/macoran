// Tohumlu (deterministik) rastgele sayı üreteci – sfc32.
// Aynı tohum -> aynı maç; script bir kez üretilir ve DB'ye yazılır.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | bigint) {
    const s = Number(BigInt(seed) & 0xffffffffn);
    let h = 0x9e3779b9 ^ s;
    const mix = () => {
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      return h >>> 0;
    };
    this.a = mix(); this.b = mix(); this.c = mix(); this.d = mix() | 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** [0,1) */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** [min,max] tam sayı */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** [min,max) reel */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standart normal (Box-Muller) */
  normal(mean = 0, sd = 1): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }

  /** Ağırlıklı seçim; ağırlıklar >= 0 */
  weighted<T>(items: T[], weight: (x: T, i: number) => number): T | undefined {
    if (!items.length) return undefined;
    const ws = items.map((x, i) => Math.max(0, weight(x, i)));
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return items[this.int(0, items.length - 1)];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  shuffle<T>(items: T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

/** Metin/sayılardan 32-bit tohum türet (FNV-1a) */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x7f;
  }
  return h >>> 0;
}

export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log-uzayında hesapla (büyük k'da taşma olmasın)
  let logp = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

/** 0..max için Poisson dağılımı; kuyruk son hücreye eklenir */
export function poissonTable(lambda: number, max: number): number[] {
  const t: number[] = [];
  let sum = 0;
  for (let k = 0; k < max; k++) {
    const p = poissonPmf(lambda, k);
    t.push(p);
    sum += p;
  }
  t.push(Math.max(0, 1 - sum));
  return t;
}
