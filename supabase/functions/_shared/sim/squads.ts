// Kadrolar ve oyuncu yetenekleri.
//  - API-Football /players/squads ile gerçek kadro (isim, forma no, mevki, foto)
//  - API'de kadro yoksa sentetik kadro
//  - Yetenekler takım gücüne göre, tohumlu rastgele dağıtılır

import type { ApiFootball } from "../api.ts";
import { hashSeed, Rng } from "./rng.ts";
import type { Position } from "./script.ts";

export interface ApiSquadPlayer {
  id: number;
  name: string;
  age: number | null;
  number: number | null;
  position: "Goalkeeper" | "Defender" | "Midfielder" | "Attacker" | string;
  photo: string | null;
}
interface ApiSquad { team: { id: number; name: string }; players: ApiSquadPlayer[] }

export function mapPosition(p: string): Position {
  switch (p) {
    case "Goalkeeper": return "GK";
    case "Defender": return "DEF";
    case "Midfielder": return "MID";
    default: return "FWD";
  }
}

export interface PlayerInsert {
  api_id: number | null;
  team_id: number;
  name: string;
  number: number | null;
  position: Position;
  age: number | null;
  photo: string | null;
  talent: number;
  finishing: number;
  creativity: number;
  aggression: number;
}

const r3 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;

/** Takım gücü (0..100) ve mevkiye göre yetenek üret */
export function rollAttributes(rng: Rng, position: Position, teamOverall: number, isStarterLike: boolean): Pick<PlayerInsert, "talent" | "finishing" | "creativity" | "aggression"> {
  const base = (teamOverall - 40) / 60; // 0..1
  const talent = r3(rng.normal(0.25 + base * 0.6 + (isStarterLike ? 0.08 : -0.06), 0.09));
  let finishing: number, creativity: number, aggression: number;
  switch (position) {
    case "GK":
      finishing = r3(rng.range(0, 0.05)); creativity = r3(rng.range(0.02, 0.12)); aggression = r3(rng.range(0.05, 0.25)); break;
    case "DEF":
      finishing = r3(rng.normal(0.18, 0.07)); creativity = r3(rng.normal(0.25, 0.1)); aggression = r3(rng.normal(0.6, 0.15)); break;
    case "MID":
      finishing = r3(rng.normal(0.42, 0.14)); creativity = r3(rng.normal(0.6, 0.15)); aggression = r3(rng.normal(0.5, 0.15)); break;
    default:
      finishing = r3(rng.normal(0.72, 0.14)); creativity = r3(rng.normal(0.45, 0.14)); aggression = r3(rng.normal(0.38, 0.14)); break;
  }
  // Yetenekli oyuncular bitiricilik/yaratıcılıkta da öne çıkar
  finishing = r3(finishing * (0.7 + talent * 0.6));
  creativity = r3(creativity * (0.7 + talent * 0.6));
  return { talent, finishing, creativity, aggression };
}

export async function fetchSquad(api: ApiFootball, teamId: number): Promise<ApiSquadPlayer[] | null> {
  const res = await api.get<ApiSquad>("/players/squads", { team: teamId });
  const squad = res.response[0];
  if (!squad || !squad.players?.length) return null;
  return squad.players;
}

export function buildPlayersFromApi(teamId: number, teamOverall: number, players: ApiSquadPlayer[]): PlayerInsert[] {
  const rng = new Rng(hashSeed("squad", teamId));
  // Aynı mevkideki forma numarası düşük olanlar "as" gibi davranır
  const byPos = new Map<Position, ApiSquadPlayer[]>();
  for (const p of players) {
    const pos = mapPosition(p.position);
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos)!.push(p);
  }
  const out: PlayerInsert[] = [];
  for (const [pos, list] of byPos) {
    const sorted = list.slice().sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
    const starterCount = pos === "GK" ? 1 : pos === "DEF" ? 4 : pos === "MID" ? 4 : 2;
    sorted.forEach((p, i) => {
      out.push({
        api_id: p.id, team_id: teamId, name: p.name, number: p.number, position: pos, age: p.age, photo: p.photo,
        ...rollAttributes(rng, pos, teamOverall, i < starterCount),
      });
    });
  }
  return out;
}

const FIRST = ["Ahmet", "Mehmet", "Emre", "Burak", "Kerem", "Arda", "Yusuf", "Can", "Berk", "Efe", "Luca", "Marco", "Diego", "Mateo", "Lucas", "Pedro", "João", "Rafael", "Nico", "Jan", "Tom", "Max", "Felix", "Jonas", "Leon", "Paul", "Hugo", "Louis", "Adam", "Sam", "Ivan", "Milan", "Luka", "Marko", "Andrei", "Kenji", "Haruki", "Min-jun", "Ali", "Omar", "Yassine", "Sofiane", "Kofi", "Sadio", "Musa", "Idrissa", "Carlos", "Andrés", "Santiago", "Thiago"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Rossi", "Bianchi", "García", "Fernández", "Silva", "Santos", "Pereira", "Costa", "Müller", "Schmidt", "Weber", "Fischer", "Dubois", "Moreau", "Laurent", "Smith", "Jones", "Brown", "Taylor", "Novak", "Horvat", "Kovač", "Popescu", "Ivanov", "Tanaka", "Sato", "Kim", "Park", "Hassan", "Benali", "Mensah", "Diallo", "Traoré", "Ndiaye", "Okafor", "Ramírez", "Torres", "Rojas", "Alves", "Martins"];

/** API'de kadro yoksa sentetik kadro (23 oyuncu) */
export function buildSyntheticPlayers(teamId: number, teamOverall: number): PlayerInsert[] {
  const rng = new Rng(hashSeed("synthetic", teamId));
  const plan: [Position, number][] = [["GK", 3], ["DEF", 8], ["MID", 7], ["FWD", 5]];
  const out: PlayerInsert[] = [];
  let number = 1;
  const used = new Set<string>();
  for (const [pos, n] of plan) {
    for (let i = 0; i < n; i++) {
      let name = "";
      do name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; while (used.has(name));
      used.add(name);
      out.push({
        api_id: null, team_id: teamId, name, number: number++, position: pos, age: rng.int(19, 34), photo: null,
        ...rollAttributes(rng, pos, teamOverall, i < (pos === "GK" ? 1 : pos === "DEF" ? 4 : pos === "MID" ? 4 : 2)),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Puan durumundan takım güçleri
// ---------------------------------------------------------------------
export interface ApiStandingRowLite {
  rank: number;
  team: { id: number };
  points: number;
  all: { played: number; goals: { for: number; against: number } };
}

export interface RatingInsert {
  team_id: number;
  league_id: number;
  attack: number;
  midfield: number;
  defense: number;
  goalkeeper: number;
  source: string;
}

/**
 * Sıralama yüzdesi -> 50..86 arası temel güç; gol atma/yeme ortalamaları hücum/defansı ayrıştırır.
 * Grup (konferans vb.) içindeki sıraya göre çalışır.
 */
/** Bir puan tablosundan takım başına (sıra yüzdesi, hücum/savunma gol sapması) çıkarır. */
function tableSignals(rows: ApiStandingRowLite[]) {
  const n = rows.length;
  const pg = (r: ApiStandingRowLite, k: "for" | "against") => (r.all.played ? r.all.goals[k] / r.all.played : 1.3);
  const avgGf = rows.reduce((a, r) => a + pg(r, "for"), 0) / Math.max(1, n);
  const avgGa = rows.reduce((a, r) => a + pg(r, "against"), 0) / Math.max(1, n);
  const m = new Map<number, { pct: number; att: number; def: number; played: number }>();
  for (const r of rows) {
    const pct = n > 1 ? 1 - (r.rank - 1) / (n - 1) : 0.5; // 1 = lider
    const w = Math.min(1, r.all.played / 6);              // az maçta gol verisi zayıf
    m.set(r.team.id, { pct, att: w * (pg(r, "for") - avgGf), def: -w * (pg(r, "against") - avgGa), played: r.all.played });
  }
  return m;
}

/**
 * Güç puanları: bu sezonun tablosu ile (varsa) geçen sezonun final tablosunun karışımı.
 * Sezon başında geçen sezon ağırlıklı; ~12 maçtan sonra tamamen bu sezon.
 * Geçen sezon ligde olmayan (yeni çıkan) takımlar alt sıralardan başlar.
 */
export function ratingsFromStandings(leagueId: number, rows: ApiStandingRowLite[], tier = 1, prev?: ApiStandingRowLite[]): RatingInsert[] {
  const cur = tableSignals(rows);
  const old = prev?.length ? tableSignals(prev) : null;
  const out: RatingInsert[] = [];
  for (const r of rows) {
    const rng = new Rng(hashSeed("rating", leagueId, r.team.id));
    const c0 = cur.get(r.team.id)!;
    let pct = c0.pct, att = c0.att, def = c0.def;
    if (old) {
      const wCur = Math.min(1, c0.played / 12);
      const p = old.get(r.team.id) ?? { pct: 0.2, att: -0.15, def: -0.15, played: 0 }; // yeni çıkan takım
      pct = wCur * c0.pct + (1 - wCur) * p.pct;
      att = wCur * c0.att + (1 - wCur) * p.att;
      def = wCur * c0.def + (1 - wCur) * p.def;
    }
    const base = 50 + 36 * Math.pow(pct, 1.15) - (tier - 1) * 6; // alt liglerde biraz daha düşük
    const attack = base + att * 8 + rng.normal(0, 1.5);
    const defense = base + def * 8 + rng.normal(0, 1.5);
    const midfield = base + rng.normal(0, 2);
    const goalkeeper = defense + rng.normal(0, 2.5);
    const c = (x: number) => Math.round(Math.min(96, Math.max(40, x)) * 100) / 100;
    out.push({ team_id: r.team.id, league_id: leagueId, attack: c(attack), midfield: c(midfield), defense: c(defense), goalkeeper: c(goalkeeper), source: "standings" });
  }
  return out;
}
