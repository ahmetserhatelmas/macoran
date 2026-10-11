import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Button, Header, IconButton, Input, Loading, Muted, Screen } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { simAdmin } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

const STATS: { type: string; label: string }[] = [
  { type: 'Ball Possession', label: 'Topla oynama %' },
  { type: 'Total Shots', label: 'Şut' },
  { type: 'Shots on Goal', label: 'İsabetli şut' },
  { type: 'Corner Kicks', label: 'Korner' },
  { type: 'Fouls', label: 'Faul' },
];

type StatSide = { team?: { name?: string }; statistics?: { type: string; value: number | string | null }[] };

function statNum(side: StatSide | undefined, type: string) {
  const raw = side?.statistics?.find((s) => s.type === type)?.value;
  if (raw == null) return '';
  return String(raw).replace('%', '');
}

export default function MatchControlScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const id = Number(fixtureId);
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const [busy, setBusy] = useState<string | null>(null);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isAdmin === false) router.replace('/(tabs)');
  }, [isAdmin, router]);

  const fixture = useQuery({
    queryKey: ['admin', 'control', id],
    enabled: Number.isFinite(id) && id > 0,
    queryFn: async () => {
      const [fx, od, det] = await Promise.all([
        supabase
          .from('fixtures')
          .select('id, date, status_short, odds_locked, home:teams!home_team_id(id, name, logo), away:teams!away_team_id(id, name, logo)')
          .eq('id', id)
          .single(),
        supabase.from('odds').select('market, selection, line, odd, suspended, bookmaker').eq('fixture_id', id),
        supabase.from('fixture_details').select('statistics, stats_locked').eq('fixture_id', id).maybeSingle(),
      ]);
      if (fx.error) throw fx.error;
      if (od.error) throw od.error;
      if (det.error) throw det.error;
      return {
        fixture: fx.data as unknown as {
          id: number;
          date: string;
          status_short: string;
          odds_locked: boolean;
          home: { name: string; logo: string | null };
          away: { name: string; logo: string | null };
        },
        odds: od.data ?? [],
        statistics: (det.data?.statistics ?? []) as StatSide[],
        stats_locked: det.data?.stats_locked === true,
      };
    },
  });

  useEffect(() => {
    const rows = fixture.data?.odds ?? [];
    const next: Record<string, string> = {};
    for (const key of ['1X2|1|0', '1X2|X|0', '1X2|2|0', 'OU|O|2.5', 'OU|U|2.5', 'BTTS|YES|0', 'BTTS|NO|0']) {
      const [market, selection, line] = key.split('|');
      const hit = rows.find((r) => r.market === market && r.selection === selection && Number(r.line) === Number(line));
      if (hit) next[key] = String(hit.odd);
    }
    setOdds(next);
    const sides = fixture.data?.statistics ?? [];
    const st: Record<string, string> = {};
    for (const type of STATS.map((s) => s.type)) {
      st[`0:${type}`] = statNum(sides[0], type);
      st[`1:${type}`] = statNum(sides[1], type);
    }
    setStats(st);
  }, [fixture.data]);

  const saveOdd = async (market: string, selection: string, line: number) => {
    const key = `${market}|${selection}|${line}`;
    const value = Number(odds[key]?.replace(',', '.'));
    setBusy(key);
    try {
      await simAdmin('set_odd', { fixture_id: id, market, selection, line, odd: value });
      await fixture.refetch();
      qc.invalidateQueries({ queryKey: ['fixtures'] });
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleSuspend = async () => {
    const on = !fixture.data?.fixture.odds_locked;
    setBusy('suspend');
    try {
      await simAdmin('suspend_odds', { fixture_id: id, suspended: on });
      await fixture.refetch();
      qc.invalidateQueries({ queryKey: ['fixtures'] });
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveStats = async (side: 0 | 1) => {
    const patch: Record<string, string> = {};
    for (const s of STATS) {
      const v = stats[`${side}:${s.type}`];
      if (v != null && v !== '') patch[s.type] = v;
    }
    setBusy(`stat-${side}`);
    try {
      await simAdmin('set_match_stats', { fixture_id: id, side: side === 0 ? 'home' : 'away', stats: patch });
      await fixture.refetch();
      qc.invalidateQueries({ queryKey: ['fixture-detail', id] });
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const f = fixture.data?.fixture;
  const locked = f?.odds_locked === true;

  return (
    <Screen>
      <Header
        title="Maç kontrol"
        subtitle={f ? `${f.home.name} - ${f.away.name}` : 'Oran, askı, istatistik'}
        left={<IconButton icon="chevron-back" onPress={() => router.back()} />}
      />
      {fixture.isLoading || !f ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 48, gap: spacing.lg }}>
          <Muted style={{ fontSize: 12 }}>{dateTime(f.date)} · {f.status_short}</Muted>

          <View style={styles.card}>
            <Text style={styles.title}>Oranlar</Text>
            <Muted style={{ fontSize: 12 }}>Yazdığın oran motor yenilese de durur. 1.01–100.</Muted>
            <OddRow label="1" value={odds['1X2|1|0'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, '1X2|1|0': v }))} onSave={() => saveOdd('1X2', '1', 0)} busy={busy === '1X2|1|0'} />
            <OddRow label="X" value={odds['1X2|X|0'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, '1X2|X|0': v }))} onSave={() => saveOdd('1X2', 'X', 0)} busy={busy === '1X2|X|0'} />
            <OddRow label="2" value={odds['1X2|2|0'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, '1X2|2|0': v }))} onSave={() => saveOdd('1X2', '2', 0)} busy={busy === '1X2|2|0'} />
            <OddRow label="2.5 Üst" value={odds['OU|O|2.5'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, 'OU|O|2.5': v }))} onSave={() => saveOdd('OU', 'O', 2.5)} busy={busy === 'OU|O|2.5'} />
            <OddRow label="2.5 Alt" value={odds['OU|U|2.5'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, 'OU|U|2.5': v }))} onSave={() => saveOdd('OU', 'U', 2.5)} busy={busy === 'OU|U|2.5'} />
            <OddRow label="KG Var" value={odds['BTTS|YES|0'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, 'BTTS|YES|0': v }))} onSave={() => saveOdd('BTTS', 'YES', 0)} busy={busy === 'BTTS|YES|0'} />
            <OddRow label="KG Yok" value={odds['BTTS|NO|0'] ?? ''} onChange={(v) => setOdds((s) => ({ ...s, 'BTTS|NO|0': v }))} onSave={() => saveOdd('BTTS', 'NO', 0)} busy={busy === 'BTTS|NO|0'} />
            <Button
              title={locked ? 'Oran askısını kaldır' : 'Tüm oranları askıya al'}
              variant={locked ? 'secondary' : 'danger'}
              loading={busy === 'suspend'}
              onPress={toggleSuspend}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>İstatistik</Text>
            <Muted style={{ fontSize: 12 }}>
              {fixture.data?.stats_locked
                ? 'Kilitli: motor bu sayıları ezmez.'
                : 'Maç başladıysa buradan düzeltebilirsin. Kayıt kilidi açar.'}
            </Muted>
            {STATS.map((s) => (
              <View key={s.type} style={styles.statRow}>
                <View style={{ flex: 1 }}>
                  <Input
                    value={stats[`0:${s.type}`] ?? ''}
                    onChangeText={(v) => setStats((p) => ({ ...p, [`0:${s.type}`]: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
                <View style={{ flex: 1 }}>
                  <Input
                    value={stats[`1:${s.type}`] ?? ''}
                    onChangeText={(v) => setStats((p) => ({ ...p, [`1:${s.type}`]: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <TeamLogo uri={f.home.logo} size={22} name={f.home.name} />
                <Button title="Ev kaydet" size="sm" loading={busy === 'stat-0'} onPress={() => saveStats(0)} />
              </View>
              <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <TeamLogo uri={f.away.logo} size={22} name={f.away.name} />
                <Button title="Dep kaydet" size="sm" loading={busy === 'stat-1'} onPress={() => saveStats(1)} />
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function OddRow({
  label, value, onChange, onSave, busy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.oddRow}>
      <Text style={styles.oddLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="—" />
      </View>
      <Button title="Kaydet" size="sm" loading={busy} onPress={onSave} style={{ minWidth: 88 }} />
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
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  oddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oddLabel: { width: 64, color: colors.text, fontWeight: '700' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { width: 110, textAlign: 'center', color: colors.textMuted, fontSize: 12 },
});
