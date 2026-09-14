import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { dayjs } from '@/lib/format';
import { LIVE_STATUSES } from '@/lib/markets';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import type { Bet, FixtureWithRelations, League, Profile, Standings, Team, Transaction } from '@/types/db';

const FIXTURE_SELECT = `*, home:teams!home_team_id(*), away:teams!away_team_id(*), league:leagues(*), odds(*)`;

function normalizeFixture(f: FixtureWithRelations): FixtureWithRelations {
  return {
    ...f,
    odds: (f.odds ?? []).map((o) => ({ ...o, odd: Number(o.odd), line: Number(o.line) })),
  };
}

export function useLeagues() {
  return useQuery({
    queryKey: ['leagues'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leagues').select('*').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data as League[];
    },
    staleTime: 60 * 60 * 1000,
  });
}

/** Belirli bir günün maçları (yerel saat). Sadece 1X2 oranları gömülür. */
export function useFixturesByDate(date: dayjs.Dayjs, leagueId: number | null) {
  const start = date.startOf('day').toISOString();
  const end = date.endOf('day').toISOString();
  return useQuery({
    queryKey: ['fixtures', 'date', start, leagueId],
    queryFn: async () => {
      let q = supabase
        .from('fixtures')
        .select(FIXTURE_SELECT)
        .gte('date', start)
        .lte('date', end)
        .eq('archived', false)
        .eq('odds.market', '1X2')
        .order('date');
      if (leagueId) q = q.eq('league_id', leagueId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as FixtureWithRelations[]).map(normalizeFixture);
    },
    refetchInterval: 60_000,
  });
}

export function useLiveFixtures() {
  return useQuery({
    queryKey: ['fixtures', 'live'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(FIXTURE_SELECT)
        .in('status_short', LIVE_STATUSES)
        .eq('archived', false)
        .eq('odds.market', '1X2')
        .order('date');
      if (error) throw error;
      return (data as unknown as FixtureWithRelations[]).map(normalizeFixture);
    },
    refetchInterval: 15_000,
  });
}

export function useFixture(id: number) {
  return useQuery({
    queryKey: ['fixture', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixtures').select(FIXTURE_SELECT).eq('id', id).single();
      if (error) throw error;
      return normalizeFixture(data as unknown as FixtureWithRelations);
    },
    enabled: Number.isFinite(id),
    refetchInterval: (q) => (q.state.data && LIVE_STATUSES.includes(q.state.data.status_short) ? 8_000 : 60_000),
  });
}

export interface FixtureEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string | null };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: 'Goal' | 'Card' | 'subst' | 'Var' | string;
  detail: string;
  comments: string | null;
}
export interface TeamStatistics {
  team: { id: number; name: string; logo: string | null };
  statistics: { type: string; value: number | string | null }[];
}
export interface FixtureDetail {
  fixture_id: number;
  events: FixtureEvent[];
  statistics: TeamStatistics[];
  final: boolean;
  updated_at: string | null;
}

/** Maç olayları + istatistikleri (simülasyon motoru fixture_details tablosuna yazar; canlıda 10 sn'de bir yenilenir). */
export function useFixtureDetail(fixtureId: number, live: boolean, enabled = true) {
  return useQuery({
    queryKey: ['fixture-detail', fixtureId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixture_details').select('*').eq('fixture_id', fixtureId).maybeSingle();
      if (error) throw error;
      return (data as FixtureDetail | null) ?? { fixture_id: fixtureId, events: [], statistics: [], final: false, updated_at: null };
    },
    enabled: enabled && Number.isFinite(fixtureId),
    refetchInterval: live ? 10_000 : false,
    staleTime: live ? 8_000 : 10 * 60 * 1000,
  });
}

// ---------------- Oyuncu istatistikleri (gol / asist krallığı) ----------------
export interface PlayerStatRow {
  player_id: number;
  league_id: number;
  apps: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  minutes: number;
  player: { id: number; name: string; number: number | null; position: string; photo: string | null; team: Team };
}

export function usePlayerStats(leagueId: number | null, orderBy: 'goals' | 'assists') {
  return useQuery({
    queryKey: ['player-stats', leagueId, orderBy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_stats')
        .select('*, player:players(id, name, number, position, photo, team:teams(*))')
        .eq('league_id', leagueId!)
        .gt(orderBy, 0)
        .order(orderBy, { ascending: false })
        .order(orderBy === 'goals' ? 'assists' : 'goals', { ascending: false })
        .order('minutes', { ascending: true })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as PlayerStatRow[];
    },
    enabled: !!leagueId,
    staleTime: 60 * 1000,
  });
}

// ---------------- Simülasyon (admin) ----------------
export interface SimLeagueStatus {
  id: number;
  name: string;
  season: number;
  is_active: boolean;
  sim_started_at: string | null;
  sim_config: {
    start_at?: string;
    round_interval_hours?: number;
    kickoff_times?: string[];
    double_round?: boolean;
    rounds?: number;
    calendar?: 'api' | 'rhythm';
    estimated?: number;
  } | null;
  teams: number;
  players: number;
  upcoming: number;
  played: number;
}
export interface SimSettingsRow {
  seconds_per_minute: number;
  halftime_seconds: number;
  goal_suspend_seconds: number;
  margin: number;
  live_margin: number;
  last_tick_at: string | null;
  last_tick_message: string | null;
}

export async function simAdmin<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('sim-admin', { body: { action, ...body } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = (await ctx.json()) as { error?: string };
        if (b?.error) throw new Error(b.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useSimStatus() {
  return useQuery({
    queryKey: ['admin', 'sim-status'],
    queryFn: () => simAdmin<{ settings: SimSettingsRow; leagues: SimLeagueStatus[] }>('status'),
    refetchInterval: 30_000,
  });
}

/** Admin: bir ligin yaklaşan simülasyon maçları (senaryo yazmak için) */
export function useUpcomingSimFixtures(leagueId: number | null) {
  return useQuery({
    queryKey: ['admin', 'upcoming', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(`id, date, round, status_short, home:teams!home_team_id(id, name, logo), away:teams!away_team_id(id, name, logo), sim_matches(scenario)`)
        .eq('league_id', leagueId!)
        .eq('is_sim', true)
        .eq('archived', false)
        .eq('status_short', 'NS')
        .order('date')
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: number; date: string; round: string | null; status_short: string;
        home: Team; away: Team;
        sim_matches: { scenario: { ht_home: number; ht_away: number; ft_home: number; ft_away: number; note?: string } | null } | null;
      }[];
    },
    enabled: !!leagueId,
  });
}

export function useStandings(leagueId: number | null) {
  return useQuery({
    queryKey: ['standings', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase.from('standings').select('*').eq('league_id', leagueId!).maybeSingle();
      if (error) throw error;
      return (data as Standings | null) ?? null;
    },
    enabled: !!leagueId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/** Ligin o an oynanan maçları (canlı puan durumu için). */
export function useLeagueLiveFixtures(leagueId: number | null) {
  return useQuery({
    queryKey: ['fixtures', 'live', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select('id, home_team_id, away_team_id, home_goals, away_goals, status_short')
        .eq('league_id', leagueId!)
        .eq('archived', false)
        .in('status_short', LIVE_STATUSES);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    refetchInterval: 10_000,
  });
}

export function useMyBets() {
  const uid = useAuth((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['bets', uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bets')
        .select('*, bet_selections(*)')
        .eq('user_id', uid!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as Bet[]).map((b) => ({
        ...b,
        stake: Number(b.stake),
        total_odd: Number(b.total_odd),
        potential_win: Number(b.potential_win),
        payout: b.payout === null ? null : Number(b.payout),
        bet_selections: b.bet_selections.map((s) => ({ ...s, odd: Number(s.odd), line: Number(s.line) })),
      }));
    },
    enabled: !!uid,
    refetchInterval: 30_000,
  });
}

export function useMyTransactions() {
  const uid = useAuth((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['transactions', uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', uid!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as Transaction[]).map((t) => ({ ...t, amount: Number(t.amount) }));
    },
    enabled: !!uid,
  });
}

// ---------------- Admin ----------------
export function useAdminUsers(search: string) {
  return useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: async () => {
      let q = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
      if (search.trim()) q = q.or(`email.ilike.%${search.trim()}%,username.ilike.%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data as Profile[]).map((p) => ({ ...p, balance: Number(p.balance) }));
    },
  });
}

export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: async () => {
      const [{ data: p, error }, { data: tx }, { data: bets }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
        supabase.from('bets').select('*, bet_selections(*)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
      ]);
      if (error) throw error;
      return {
        profile: { ...(p as Profile), balance: Number(p.balance) },
        transactions: ((tx ?? []) as Transaction[]).map((t) => ({ ...t, amount: Number(t.amount) })),
        bets: ((bets ?? []) as Bet[]).map((b) => ({
          ...b,
          stake: Number(b.stake),
          total_odd: Number(b.total_odd),
          potential_win: Number(b.potential_win),
          payout: b.payout === null ? null : Number(b.payout),
        })),
      };
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_stats');
      if (error) throw error;
      return data as {
        users: number;
        total_balance: number;
        open_bets: number;
        total_bets: number;
        live_fixtures: number;
        sim: {
          last_tick_at: string | null;
          last_tick_message: string | null;
          seconds_per_minute: number;
          started_leagues: number;
          players: number;
          upcoming: number;
        } | null;
        last_sync: { job: string; ok: boolean; message: string; requests: number; at: string }[] | null;
      } | null;
    },
    refetchInterval: 30_000,
  });
}

/**
 * Realtime: fikstür/oran/kupon değişikliklerinde ilgili sorguları tazele.
 * Olaylar 1.5 sn debounce edilir.
 */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const uid = useAuth((s) => s.session?.user.id);

  useEffect(() => {
    if (!uid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();

    const flush = () => {
      timer = null;
      for (const key of pending) qc.invalidateQueries({ queryKey: [key] });
      pending.clear();
    };
    const schedule = (key: string) => {
      pending.add(key);
      if (!timer) timer = setTimeout(flush, 1500);
    };

    const ch = supabase
      .channel('macoran-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fixtures' }, () => {
        schedule('fixtures');
        schedule('fixture');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'odds' }, () => {
        schedule('fixtures');
        schedule('fixture');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${uid}` }, () => {
        schedule('bets');
        schedule('transactions');
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      ch.unsubscribe();
    };
  }, [qc, uid]);
}
