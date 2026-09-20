import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';

interface FavoritesState {
  ids: number[];
  has: (id: number) => boolean;
  toggle: (id: number) => void;
  syncWithServer: () => Promise<void>;
}

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      ids: [],
      has: (id) => get().ids.includes(id),
      toggle: (id) => {
        const on = !get().ids.includes(id);
        set((s) => ({
          ids: on ? [id, ...s.ids] : s.ids.filter((x) => x !== id),
        }));
        supabase.auth.getSession().then(({ data }) => {
          const uid = data.session?.user.id;
          if (!uid) return;
          if (on) {
            supabase.from('favorite_fixtures').upsert({ user_id: uid, fixture_id: id }).then(({ error }) => {
              if (error) console.warn('[fav] add', error.message);
            });
          } else {
            supabase.from('favorite_fixtures').delete().eq('user_id', uid).eq('fixture_id', id).then(({ error }) => {
              if (error) console.warn('[fav] del', error.message);
            });
          }
        });
      },
      syncWithServer: async () => {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user.id;
        if (!uid) return;
        const local = get().ids;
        const { data, error } = await supabase.from('favorite_fixtures').select('fixture_id').eq('user_id', uid);
        if (error) {
          console.warn('[fav] sync', error.message);
          return;
        }
        const remote = (data ?? []).map((r) => Number(r.fixture_id));
        const merged = [...new Set([...local, ...remote])];
        const missing = local.filter((id) => !remote.includes(id));
        if (missing.length) {
          await supabase.from('favorite_fixtures').upsert(missing.map((fixture_id) => ({ user_id: uid, fixture_id })));
        }
        set({ ids: merged });
      },
    }),
    {
      name: 'macoran-favorites',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ids: s.ids }),
    },
  ),
);
