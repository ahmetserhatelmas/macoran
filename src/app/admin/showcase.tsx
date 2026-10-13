import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Header, IconButton, Input, Loading, Muted, Screen } from '@/components/ui';
import { money } from '@/lib/format';
import { simAdmin } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

type Leg = { home: string | null; away: string | null; selection: string; status: string; score: string | null };
type Coupon = {
  bet_id: string;
  status: string;
  stake: number;
  payout: number;
  note: string | null;
  legs: Leg[];
};
type Account = { id: string; username: string; day: number; week: number; total: number; coupons: Coupon[] };
type FixturePick = {
  id: number;
  home_goals: number | null;
  away_goals: number | null;
  home: { name: string } | { name: string }[];
  away: { name: string } | { name: string }[];
};

type DraftLeg = { fixture_id: number; label: string; score: string; won: boolean };
type Place = '' | 'day' | 'week' | 'total';

const nameOf = (t: FixturePick['home']) => (Array.isArray(t) ? t[0]?.name : t?.name) ?? '';

export default function ShowcaseScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin === false) router.replace('/(tabs)');
  }, [isAdmin, router]);

  const list = useQuery({
    queryKey: ['admin', 'showcase'],
    queryFn: () => simAdmin<{ accounts: Account[] }>('showcase_list'),
  });

  const refresh = async () => {
    await list.refetch();
    qc.invalidateQueries({ queryKey: ['coupon-feed'] });
    qc.invalidateQueries({ queryKey: ['coupon-ranks'] });
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
      Alert.alert('Vitrin', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const createUser = () => run('user', async () => {
    await simAdmin('showcase_create_user', { username });
    setUsername('');
  });

  const removeUser = (a: Account) => {
    Alert.alert('Hesabı sil', `${a.username} ve kuponları kaldırılsın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => run(a.id, () => simAdmin('showcase_delete_user', { user_id: a.id }).then(() => undefined)) },
    ]);
  };

  return (
    <Screen>
      <Header title="Vitrin kupon" subtitle="Akış ve sıralama" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
      {list.isLoading ? <Loading /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 48, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Yeni hesap</Text>
            <Muted style={{ fontSize: 12 }}>Bu hesap giriş yapamaz. Sadece akışta ve sıralamada görünür.</Muted>
            <Input placeholder="kullaniciadi" value={username} onChangeText={setUsername} autoCapitalize="none" />
            <Button title="Hesabı aç" loading={busy === 'user'} onPress={createUser} />
          </View>

          {(list.data?.accounts ?? []).map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              open={openUser === a.id}
              busy={busy}
              onToggle={() => setOpenUser(openUser === a.id ? null : a.id)}
              onRename={(name) => run(`name-${a.id}`, () => simAdmin('showcase_rename', { user_id: a.id, username: name }).then(() => undefined))}
              onDelete={() => removeUser(a)}
              onDeleteCoupon={(id) => run(id, () => simAdmin('showcase_delete_coupon', { bet_id: id }).then(() => undefined))}
              onSaveCoupon={(id, stake, payout, place) => run(id, () => simAdmin('showcase_update_coupon', {
                bet_id: id, stake, payout, ...(place ? { place } : {}),
              }).then(() => undefined))}
              onCreate={(body) => run(`new-${a.id}`, () => simAdmin('showcase_create_coupon', { user_id: a.id, ...body }).then(() => undefined))}
            />
          ))}
          {(list.data?.accounts ?? []).length === 0 ? <Muted>Henüz vitrin hesabı yok.</Muted> : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function AccountCard({
  account, open, busy, onToggle, onRename, onDelete, onDeleteCoupon, onSaveCoupon, onCreate,
}: {
  account: Account;
  open: boolean;
  busy: string | null;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDeleteCoupon: (id: string) => void;
  onSaveCoupon: (id: string, stake: number, payout: number, place: Place) => void;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(account.username);
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle} style={styles.row}>
        <Text style={styles.title}>{account.username}</Text>
        <Badge text={open ? 'Kapat' : 'Düzenle'} color={colors.surface3} textColor={colors.text} />
      </Pressable>
      <Muted style={{ fontSize: 12 }}>Gün {money(account.day)} · Hafta {money(account.week)} · Toplam {money(account.total)}</Muted>
      {open ? (
        <>
          <Input value={name} onChangeText={setName} autoCapitalize="none" />
          <View style={styles.row}>
            <Button title="Adı kaydet" size="sm" loading={busy === `name-${account.id}`} onPress={() => onRename(name)} />
            <Button title="Hesabı sil" size="sm" variant="danger" loading={busy === account.id} onPress={onDelete} />
          </View>
          {account.coupons.map((c) => (
            <CouponEditor key={c.bet_id} coupon={c} busy={busy === c.bet_id} onDelete={() => onDeleteCoupon(c.bet_id)} onSave={(stake, payout, place) => onSaveCoupon(c.bet_id, stake, payout, place)} />
          ))}
          <Composer busy={busy === `new-${account.id}`} onCreate={onCreate} />
        </>
      ) : null}
    </View>
  );
}

function CouponEditor({
  coupon, busy, onDelete, onSave,
}: {
  coupon: Coupon;
  busy: boolean;
  onDelete: () => void;
  onSave: (stake: number, payout: number, place: Place) => void;
}) {
  const [stake, setStake] = useState(String(coupon.stake));
  const [payout, setPayout] = useState(String(coupon.payout));
  const [place, setPlace] = useState<Place>('');
  const won = coupon.status === 'won' || coupon.status === 'cashed';
  return (
    <View style={styles.coupon}>
      <View style={styles.row}>
        <Badge text={won ? 'Tuttu' : 'Yattı'} color={won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'} textColor={won ? colors.success : colors.danger} />
        <Text style={styles.meta}>{money(coupon.payout)}</Text>
      </View>
      {coupon.legs.map((l, i) => (
        <Text key={i} style={styles.leg}>{l.home} - {l.away} {l.score ? `(${l.score})` : ''} · {l.status === 'won' ? 'tuttu' : 'yattı'}</Text>
      ))}
      {won ? (
        <>
          <Input value={stake} onChangeText={setStake} keyboardType="decimal-pad" placeholder="Tutar" />
          <Input value={payout} onChangeText={setPayout} keyboardType="decimal-pad" placeholder="Kazanç" />
          <PlaceRow place={place} onChange={setPlace} />
          <Button title="Kazancı güncelle" size="sm" loading={busy} onPress={() => onSave(Number(stake.replace(',', '.')), Number(payout.replace(',', '.')), place)} />
        </>
      ) : null}
      <Button title="Kuponu sil" size="sm" variant="danger" onPress={onDelete} />
    </View>
  );
}

function Composer({ busy, onCreate }: { busy: boolean; onCreate: (body: Record<string, unknown>) => void }) {
  const [q, setQ] = useState('');
  const [legs, setLegs] = useState<DraftLeg[]>([]);
  const [stake, setStake] = useState('50');
  const [payout, setPayout] = useState('500');
  const [place, setPlace] = useState<Place>('');
  const fixtures = useQuery({
    queryKey: ['admin', 'showcase-fixtures'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select('id, home_goals, away_goals, home:teams!home_team_id(name), away:teams!away_team_id(name)')
        .in('status_short', ['FT', 'AET', 'PEN'])
        .order('date', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as FixturePick[];
    },
  });
  const needle = q.trim().toLocaleLowerCase('tr');
  const shown = (fixtures.data ?? []).filter((f) => {
    const label = `${nameOf(f.home)} ${nameOf(f.away)}`.toLocaleLowerCase('tr');
    return !needle || label.includes(needle);
  }).slice(0, 8);
  const allWon = legs.length > 0 && legs.every((l) => l.won);

  return (
    <View style={styles.coupon}>
      <Text style={styles.title}>Kupon ekle</Text>
      <Muted style={{ fontSize: 12 }}>Bitmiş maç seç. Tuttu ya da yattı de. Karışık kupon akışta yatan görünür. Sıralama için hepsi tutmalı.</Muted>
      <Input placeholder="Maç ara" value={q} onChangeText={setQ} />
      {shown.map((f) => {
        const label = `${nameOf(f.home)} - ${nameOf(f.away)}`;
        const added = legs.some((l) => l.fixture_id === f.id);
        return (
          <Pressable
            key={f.id}
            disabled={added}
            onPress={() => setLegs((rows) => [...rows, { fixture_id: f.id, label, score: `${f.home_goals}-${f.away_goals}`, won: true }])}
            style={styles.pick}
          >
            <Text style={styles.leg}>{label}  {f.home_goals}-{f.away_goals}</Text>
            <Text style={styles.meta}>{added ? 'Eklendi' : 'Ekle'}</Text>
          </Pressable>
        );
      })}
      {legs.map((l) => (
        <View key={l.fixture_id} style={styles.row}>
          <Text style={[styles.leg, { flex: 1 }]}>{l.label}</Text>
          <Pressable onPress={() => setLegs((rows) => rows.map((r) => r.fixture_id === l.fixture_id ? { ...r, won: !r.won } : r))}>
            <Badge text={l.won ? 'Tuttu' : 'Yattı'} color={l.won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'} textColor={l.won ? colors.success : colors.danger} />
          </Pressable>
          <Pressable onPress={() => setLegs((rows) => rows.filter((r) => r.fixture_id !== l.fixture_id))}>
            <Text style={styles.meta}>Sil</Text>
          </Pressable>
        </View>
      ))}
      <Input value={stake} onChangeText={setStake} keyboardType="decimal-pad" placeholder="Tutar" />
      {allWon ? (
        <>
          <Input value={payout} onChangeText={setPayout} keyboardType="decimal-pad" placeholder="Kazanç" />
          <PlaceRow place={place} onChange={setPlace} />
        </>
      ) : null}
      <Button
        title="Akışa koy"
        loading={busy}
        disabled={!legs.length}
        onPress={() => onCreate({
          stake: Number(stake.replace(',', '.')),
          payout: Number(payout.replace(',', '.')),
          place: allWon ? place || undefined : undefined,
          show_stake: true,
          legs: legs.map((l) => ({ fixture_id: l.fixture_id, won: l.won })),
        })}
      />
    </View>
  );
}

function PlaceRow({ place, onChange }: { place: Place; onChange: (p: Place) => void }) {
  const opts: { key: Place; label: string }[] = [
    { key: '', label: 'Tutarı ben yazarım' },
    { key: 'day', label: 'Günün 1.' },
    { key: 'week', label: 'Haftanın 1.' },
    { key: 'total', label: 'Toplam 1.' },
  ];
  return (
    <View style={styles.places}>
      {opts.map((o) => (
        <Pressable key={o.key || 'manual'} onPress={() => onChange(o.key)} style={[styles.place, place === o.key && styles.placeOn]}>
          <Text style={[styles.placeTxt, place === o.key && { color: colors.bg }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  coupon: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  leg: { color: colors.text, fontSize: 13 },
  pick: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  places: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  place: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surface3 },
  placeOn: { backgroundColor: colors.text },
  placeTxt: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
});
