import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Odd } from '@/types/db';

export interface BetslipSelection {
  fixture_id: number;
  market: string;
  selection: string;
  line: number;
  odd: number;
  is_live: boolean;
  home_name: string;
  away_name: string;
  league_name: string;
  fixture_date: string;
  /** Sunucudan gelen oran değişince true olur */
  changed?: boolean;
}

interface BetslipState {
  selections: BetslipSelection[];
  stake: string;
  toggle: (sel: BetslipSelection) => void;
  remove: (fixtureId: number) => void;
  clear: () => void;
  setStake: (s: string) => void;
  /** Ekrandaki güncel oranlarla kupondaki oranları senkronla */
  syncOdds: (odds: Odd[]) => void;
  acknowledgeChanges: () => void;
  isSelected: (fixtureId: number, market: string, selection: string, line: number) => boolean;
}

export const MAX_SELECTIONS = 15;

export const useBetslip = create<BetslipState>()(
  persist(
    (set, get) => ({
      selections: [],
      stake: '50',

      toggle: (sel) => {
        const list = get().selections;
        const same = list.find(
          (s) =>
            s.fixture_id === sel.fixture_id &&
            s.market === sel.market &&
            s.selection === sel.selection &&
            s.line === sel.line
        );
        if (same) {
          set({ selections: list.filter((s) => s !== same) });
          return;
        }
        // Aynı maçtan tek seçim: varsa değiştir
        const withoutFixture = list.filter((s) => s.fixture_id !== sel.fixture_id);
        if (withoutFixture.length >= MAX_SELECTIONS) return;
        set({ selections: [...withoutFixture, { ...sel, changed: false }] });
      },

      remove: (fixtureId) => set({ selections: get().selections.filter((s) => s.fixture_id !== fixtureId) }),
      clear: () => set({ selections: [] }),
      setStake: (stake) => set({ stake: stake.replace(/[^\d]/g, '').slice(0, 7) }),

      syncOdds: (odds) => {
        if (!odds.length) return;
        let dirty = false;
        const next = get().selections.map((s) => {
          const o = odds.find(
            (x) => x.fixture_id === s.fixture_id && x.market === s.market && x.selection === s.selection && Number(x.line) === Number(s.line)
          );
          if (!o) return s;
          const newOdd = Number(o.odd);
          if (Math.abs(newOdd - s.odd) > 0.0005) {
            dirty = true;
            return { ...s, odd: newOdd, changed: true, is_live: o.is_live };
          }
          if (o.is_live !== s.is_live) {
            dirty = true;
            return { ...s, is_live: o.is_live };
          }
          return s;
        });
        if (dirty) set({ selections: next });
      },

      acknowledgeChanges: () => set({ selections: get().selections.map((s) => ({ ...s, changed: false })) }),

      isSelected: (fixtureId, market, selection, line) =>
        get().selections.some(
          (s) => s.fixture_id === fixtureId && s.market === market && s.selection === selection && Number(s.line) === Number(line)
        ),
    }),
    {
      name: 'macoran-betslip',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ selections: s.selections, stake: s.stake }),
    }
  )
);

export function totalOdd(selections: BetslipSelection[]) {
  return selections.reduce((acc, s) => acc * s.odd, 1);
}
