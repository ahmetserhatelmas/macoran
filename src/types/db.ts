export type BetStatus = 'pending' | 'won' | 'lost' | 'void';

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  balance: number;
  is_admin: boolean;
  created_at: string;
}

export interface League {
  id: number;
  name: string;
  country: string | null;
  logo: string | null;
  flag: string | null;
  season: number;
  sort_order: number;
  is_active: boolean;
}

export interface Team {
  id: number;
  name: string;
  logo: string | null;
}

export interface Odd {
  fixture_id: number;
  market: string;
  selection: string;
  line: number;
  odd: number;
  suspended: boolean;
  is_live: boolean;
  bookmaker: string | null;
  updated_at: string;
}

export interface Fixture {
  id: number;
  league_id: number;
  season: number;
  round: string | null;
  date: string;
  status_short: string;
  status_long: string | null;
  elapsed: number | null;
  home_team_id: number;
  away_team_id: number;
  home_goals: number | null;
  away_goals: number | null;
  ht_home: number | null;
  ht_away: number | null;
  ft_home: number | null;
  ft_away: number | null;
  et_home: number | null;
  et_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  venue: string | null;
  settled: boolean;
  /** Oranların en son hesaplandığı an (canlıda her dakika güncellenir) */
  live_odds_at?: string | null;
  /** Simülasyon motoru tarafından oynanan maç */
  is_sim?: boolean;
  /** Eski dönem (API) ya da sıfırlanan lig maçı; listelerde gösterilmez */
  archived?: boolean;
  updated_at: string;
}

export interface SimScenario {
  ht_home: number;
  ht_away: number;
  ft_home: number;
  ft_away: number;
  note?: string;
  locked?: boolean;
  goals?: { side: 'home' | 'away'; half: 1 | 2; at?: number | 'stoppage'; extra?: number | null }[];
}

export interface FixtureWithRelations extends Fixture {
  home: Team;
  away: Team;
  league: League;
  odds: Odd[];
  sim_matches?: {
    scenario: SimScenario | null;
    facts: { h1: number; a1: number; h2: number; a2: number } | null;
    script?: {
      events: {
        time: { half: 1 | 2; minute: number; extra: number | null };
        side: 'home' | 'away';
        type: string;
        detail: string;
        admin?: boolean;
      }[];
    } | null;
  } | null;
}

export interface BetSelection {
  id: string;
  bet_id: string;
  fixture_id: number;
  market: string;
  selection: string;
  line: number;
  odd: number;
  is_live: boolean;
  home_name: string | null;
  away_name: string | null;
  league_name: string | null;
  fixture_date: string | null;
  status: BetStatus;
  result_home: number | null;
  result_away: number | null;
}

export interface Bet {
  id: string;
  user_id: string;
  stake: number;
  total_odd: number;
  potential_win: number;
  payout: number | null;
  status: BetStatus;
  created_at: string;
  settled_at: string | null;
  bet_selections: BetSelection[];
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'grant' | 'deduct' | 'bet' | 'win' | 'refund';
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  group: string;
  form: string | null;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
}

export interface Standings {
  league_id: number;
  season: number;
  data: StandingRow[][];
  updated_at: string;
}
