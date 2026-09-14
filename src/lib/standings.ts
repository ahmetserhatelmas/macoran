import type { StandingRow } from '@/types/db';

export interface LiveResult {
  home_team_id: number;
  away_team_id: number;
  home_goals: number | null;
  away_goals: number | null;
}

export type LiveStandingRow = StandingRow & { live?: boolean };

function cloneRecord(r: StandingRow['all']): StandingRow['all'] {
  return {
    played: r.played,
    win: r.win,
    draw: r.draw,
    lose: r.lose,
    goals: { for: r.goals.for, against: r.goals.against },
  };
}

function cloneRow(r: StandingRow): LiveStandingRow {
  return {
    ...r,
    all: cloneRecord(r.all),
    team: { ...r.team },
  };
}

function apply(r: LiveStandingRow, gf: number, ga: number) {
  r.all.played += 1;
  r.all.goals.for += gf;
  r.all.goals.against += ga;
  if (gf > ga) {
    r.all.win += 1;
    r.points += 3;
  } else if (gf < ga) {
    r.all.lose += 1;
  } else {
    r.all.draw += 1;
    r.points += 1;
  }
  r.goalsDiff = r.all.goals.for - r.all.goals.against;
}

/** Bitmiş tabloya canlı skorları geçici olarak ekler; sıra/averaj anlık skora göre yeniden hesaplanır. */
export function overlayLiveStandings(groups: StandingRow[][], live: LiveResult[]): LiveStandingRow[][] {
  if (!live.length) return groups;
  return groups.map((group) => {
    const rows = group.map(cloneRow);
    const byId = new Map(rows.map((r) => [r.team.id, r]));
    const liveIds = new Set<number>();
    for (const m of live) {
      const h = byId.get(m.home_team_id);
      const a = byId.get(m.away_team_id);
      if (!h || !a) continue;
      const hg = m.home_goals ?? 0;
      const ag = m.away_goals ?? 0;
      apply(h, hg, ag);
      apply(a, ag, hg);
      liveIds.add(h.team.id);
      liveIds.add(a.team.id);
    }
    if (!liveIds.size) return rows;
    rows.sort(
      (x, y) =>
        y.points - x.points ||
        y.goalsDiff - x.goalsDiff ||
        y.all.goals.for - x.all.goals.for ||
        x.team.name.localeCompare(y.team.name, 'tr'),
    );
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.live = liveIds.has(r.team.id);
    });
    return rows;
  });
}
