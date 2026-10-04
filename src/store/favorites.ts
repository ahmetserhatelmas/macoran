import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';

interface FavoritesState {
  ids: number[];
  hydrated: boolean;
  has: (id: number) => boolean;
  toggle: (id: number) => void;
  syncWithServer: () => Promise<void>;
}

async function sessionUid(tries = 8): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (uid) return uid;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function writeFavorite(id: number, on: boolean): Promise<boolean> {
  const uid = await sessionUid();
  if (!uid) {
    console.warn('[fav] no session');
    return false;
  }
  const { error } = await supabase.rpc('set_favorite', { p_fixture_id: id, p_on: on });
  if (!error) return true;
  console.warn('[fav] rpc', error.message);
  if (on) {
    const ins = await supabase.from('favorite_fixtures').upsert({ user_id: uid, fixture_id: id }, { onConflict: 'user_id,fixture_id' });
    if (ins.error) {
      console.warn('[fav] add', ins.error.message);
      return false;
    }
    return true;
  }
  const del = await supabase.from('favorite_fixtures').delete().eq('user_id', uid).eq('fixture_id', id);
  if (del.error) {
    console.warn('[fav] del', del.error.message);
    return false;
  }
  return true;
}

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      ids: [],
      hydrated: false,
      has: (id) => get().ids.includes(id),
      toggle: (id) => {
        const on = !get().ids.includes(id);
        set((s) => ({
          ids: on ? [id, ...s.ids] : s.ids.filter((x) => x !== id),
        }));
        void writeFavorite(id, on).then((ok) => {
          if (ok) return;
          set((s) => ({
            ids: on ? s.ids.filter((x) => x !== id) : [id, ...s.ids],
          }));
        });
      },
      syncWithServer: async () => {
        const uid = await sessionUid();
        if (!uid) return;
        const local = get().ids;
        const { data, error } = await supabase.from('favorite_fixtures').select('fixture_id').eq('user_id', uid);
        if (error) {
          console.warn('[fav] sync', error.message);
          return;
        }
        const remote = (data ?? []).map((r) => Number(r.fixture_id)).filter((n) => Number.isFinite(n));
        const missing = local.filter((id) => !remote.includes(id));
        if (missing.length) {
          await Promise.all(missing.map((id) => writeFavorite(id, true)));
        }
        set({ ids: [...new Set([...local, ...remote])], hydrated: true });
      },
    }),
    {
      name: 'macoran-favorites',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ids: s.ids }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
