// fixture_details yazımı (olaylar, istatistikler, kadrolar)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TeamInfo } from "./league.ts";
import { countUpTo, timelineEvents, type PlayerRef, type Script } from "./script.ts";

export interface DetailFixture {
  id: number;
  home_team_id: number;
  away_team_id: number;
}

function packPlayer(p: PlayerRef) {
  return { id: p.id, name: p.name, number: p.number, position: p.position, photo: p.photo ?? null, grid: p.grid ?? null };
}

export async function writeDetails(
  db: SupabaseClient,
  f: DetailFixture,
  script: Script,
  teams: Map<number, TeamInfo>,
  k: number,
  final: boolean,
  maxEvents = Infinity,
) {
  const home = teams.get(f.home_team_id) ?? { id: f.home_team_id, name: "Ev Sahibi", logo: null };
  const away = teams.get(f.away_team_id) ?? { id: f.away_team_id, name: "Deplasman", logo: null };
  const packed = timelineEvents(script, k, maxEvents);

  const events = packed.map((e) => {
    const benefitsHome = e.side === "home";
    const teamSide = e.type === "Goal" && e.detail === "Own Goal" ? !benefitsHome : benefitsHome;
    const t = teamSide ? home : away;
    return {
      time: { elapsed: e.time.minute, extra: e.time.extra },
      team: { id: t.id, name: t.name, logo: t.logo },
      player: { id: e.player?.id ?? null, name: e.player?.name ?? null },
      assist: { id: e.assist?.id ?? null, name: e.assist?.name ?? null },
      type: e.type,
      detail: e.detail,
      comments: e.comments,
    };
  });

  const absMinute = k >= 999 ? 95 : k === 99 ? 47 : k >= 100 ? k - 100 : k;
  const progress = Math.min(1, absMinute / 95);
  const statsFor = (side: "home" | "away", t: TeamInfo) => {
    const s = script.stats[side];
    const shots = countUpTo(s.shots, k), sot = countUpTo(s.sot, k), corners = countUpTo(s.corners, k);
    const fouls = countUpTo(s.fouls, k), offsides = countUpTo(s.offsides, k), saves = countUpTo(s.saves, k);
    const blocked = Math.floor((shots - sot) * 0.3);
    const off = Math.max(0, shots - sot - blocked);
    const cards = packed.filter((e) => e.side === side && e.type === "Card");
    const yellow = cards.filter((e) => e.detail === "Yellow Card" || e.detail === "Second Yellow card").length;
    const red = cards.filter((e) => e.detail === "Red Card" || e.detail === "Second Yellow card").length;
    const passes = Math.round(s.passes * progress);
    return {
      team: { id: t.id, name: t.name, logo: t.logo },
      statistics: [
        { type: "Ball Possession", value: `${s.possession}%` },
        { type: "Total Shots", value: sot + off },
        { type: "Shots on Goal", value: sot },
        { type: "Shots off Goal", value: off },
        { type: "Blocked Shots", value: blocked },
        { type: "Corner Kicks", value: corners },
        { type: "Offsides", value: offsides },
        { type: "Fouls", value: fouls },
        { type: "Yellow Cards", value: yellow },
        { type: "Red Cards", value: red },
        { type: "Goalkeeper Saves", value: saves },
        { type: "Total passes", value: passes },
        { type: "Passes accurate", value: Math.round(passes * s.passAcc / 100) },
        { type: "Passes %", value: `${s.passAcc}%` },
      ],
    };
  };

  const packSide = (side: "home" | "away", t: TeamInfo) => {
    const lu = script.lineups[side];
    return {
      team: { id: t.id, name: t.name, logo: t.logo },
      formation: lu.formation,
      starters: lu.starters.map(packPlayer),
      bench: lu.bench.map(packPlayer),
    };
  };

  const { error } = await db.from("fixture_details").upsert({
    fixture_id: f.id,
    events,
    statistics: [statsFor("home", home), statsFor("away", away)],
    lineups: { home: packSide("home", home), away: packSide("away", away) },
    final,
    updated_at: new Date().toISOString(),
  }, { onConflict: "fixture_id" });
  if (error) throw error;
}
