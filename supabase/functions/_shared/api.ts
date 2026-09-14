// API-Football (api-sports.io) istemcisi – Edge Function tarafında çalışır.
// Anahtar sadece sunucuda tutulur; mobil uygulamaya asla gömülmez.

const BASE = "https://v3.football.api-sports.io";

export class ApiFootball {
  requests = 0;
  constructor(private readonly key: string) {
    if (!key) throw new Error("API_FOOTBALL_KEY tanımlı değil");
  }

  async get<T = unknown>(
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<{ response: T[]; paging: { current: number; total: number }; errors: unknown }> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    // Dakikalık limit aşımında kısa bekleyip tekrar dene (en fazla 4 deneme)
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await fetch(url, { headers: { "x-apisports-key": this.key } });
      if (res.status === 429 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`API-Football ${path} HTTP ${res.status}`);
      }
      const json = await res.json();
      const errs = json.errors;
      const hasErr = errs && ((Array.isArray(errs) && errs.length) || (typeof errs === "object" && Object.keys(errs).length));
      if (hasErr) {
        const text = JSON.stringify(errs);
        if (/rateLimit|requests per minute/i.test(text) && attempt < 3) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(`API-Football ${path}: ${text}`);
      }
      // Ardışık istekler arasında küçük bir nefes payı
      await sleep(120);
      return json;
    }
  }
}

// ------------------------------------------------------------------
// API tipleri (kullanılan alanlar)
// ------------------------------------------------------------------
export interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    status: { long: string; short: string; elapsed: number | null };
    venue: { name: string | null; city: string | null };
  };
  league: { id: number; season: number; round: string; name: string; logo: string; flag: string | null };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}

export const LIVE_STATUSES = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
export const FINISHED_STATUSES = ["FT", "AET", "PEN"];
export const CLOSED_STATUSES = ["CANC", "ABD", "AWD", "WO"];

export function mapFixtureRow(f: ApiFixture) {
  return {
    id: f.fixture.id,
    league_id: f.league.id,
    season: f.league.season,
    round: f.league.round,
    date: f.fixture.date,
    status_short: f.fixture.status.short,
    status_long: f.fixture.status.long,
    elapsed: f.fixture.status.elapsed,
    home_team_id: f.teams.home.id,
    away_team_id: f.teams.away.id,
    home_goals: f.goals.home,
    away_goals: f.goals.away,
    ht_home: f.score.halftime.home,
    ht_away: f.score.halftime.away,
    ft_home: f.score.fulltime.home,
    ft_away: f.score.fulltime.away,
    et_home: f.score.extratime.home,
    et_away: f.score.extratime.away,
    pen_home: f.score.penalty.home,
    pen_away: f.score.penalty.away,
    venue: f.fixture.venue?.name ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function mapTeams(fixtures: ApiFixture[]) {
  const m = new Map<number, { id: number; name: string; logo: string }>();
  for (const f of fixtures) {
    m.set(f.teams.home.id, { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo });
    m.set(f.teams.away.id, { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo });
  }
  return [...m.values()];
}

/** Lig + sezonun tüm fikstürü (sayfalıysa hepsini toplar). */
export async function fetchSeasonFixtures(api: ApiFootball, leagueId: number, season: number): Promise<ApiFixture[]> {
  const first = await api.get<ApiFixture>("/fixtures", { league: leagueId, season });
  const all = [...(first.response ?? [])];
  const total = Math.max(1, Number(first.paging?.total ?? 1));
  for (let page = 2; page <= total && page <= 40; page++) {
    const res = await api.get<ApiFixture>("/fixtures", { league: leagueId, season, page });
    all.push(...(res.response ?? []));
  }
  return all;
}

export function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
