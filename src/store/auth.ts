import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import { unregisterPushToken } from '@/lib/push';
import type { Profile } from '@/types/db';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  initialized: boolean;
  init: () => void;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

let profileChannel: RealtimeChannel | null = null;

function subscribeProfile(userId: string, set: (p: Partial<AuthState>) => void) {
  profileChannel?.unsubscribe();
  profileChannel = supabase
    .channel(`profile:${userId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
      (payload) => set({ profile: payload.new as Profile })
    )
    .subscribe();
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initialized: false,

  init: () => {
    supabase.auth.getSession().then(async ({ data }) => {
      set({ session: data.session });
      if (data.session) {
        await get().refreshProfile();
        subscribeProfile(data.session.user.id, set);
      }
      set({ initialized: true });
    });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      set({ session });
      if (session) {
        await get().refreshProfile();
        subscribeProfile(session.user.id, set);
      } else {
        profileChannel?.unsubscribe();
        profileChannel = null;
        set({ profile: null });
      }
    });
  },

  refreshProfile: async () => {
    const uid = get().session?.user.id;
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) set({ profile: { ...data, balance: Number(data.balance) } as Profile });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? translateAuthError(error.message) : null;
  },

  signUp: async (email, password, username) => {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: username.trim() } },
    });
    return error ? translateAuthError(error.message) : null;
  },

  signOut: async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
  },
}));

function translateAuthError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (m.includes('email not confirmed')) return 'E-posta adresinizi doğrulamanız gerekiyor.';
  if (m.includes('already registered')) return 'Bu e-posta zaten kayıtlı.';
  if (m.includes('password should be at least')) return 'Şifre en az 6 karakter olmalı.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Geçersiz e-posta adresi.';
  if (m.includes('rate limit')) return 'Çok fazla deneme. Biraz sonra tekrar deneyin.';
  if (m.includes('username') && m.includes('unique')) return 'Bu kullanıcı adı alınmış.';
  return msg;
}
