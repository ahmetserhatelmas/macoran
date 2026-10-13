import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Muted } from '@/components/ui';
import type { TeamStatistics } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';

/** API istatistik tipleri -> Türkçe etiket (görüntüleme sırası bu listeye göre) */
const STAT_LABELS: [string, string][] = [
  ['Ball Possession', 'Topla Oynama'],
  ['Total Shots', 'Toplam Şut'],
  ['Shots on Goal', 'İsabetli Şut'],
  ['Shots off Goal', 'İsabetsiz Şut'],
  ['Blocked Shots', 'Bloklanan Şut'],
  ['Shots insidebox', 'Ceza Sahası İçi Şut'],
  ['Shots outsidebox', 'Ceza Sahası Dışı Şut'],
  ['expected_goals', 'Gol Beklentisi (xG)'],
  ['Corner Kicks', 'Korner'],
  ['Offsides', 'Ofsayt'],
  ['Fouls', 'Faul'],
  ['Yellow Cards', 'Sarı Kart'],
  ['Red Cards', 'Kırmızı Kart'],
  ['Goalkeeper Saves', 'Kaleci Kurtarışı'],
  ['Total passes', 'Toplam Pas'],
  ['Passes accurate', 'İsabetli Pas'],
  ['Passes %', 'Pas İsabeti'],
];

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '0';
  return String(v);
}

const ADJUSTABLE: Record<string, 'corners' | 'shots' | 'sot'> = {
  'Corner Kicks': 'corners',
  'Total Shots': 'shots',
  'Shots on Goal': 'sot',
};

interface Props {
  stats: TeamStatistics[];
  homeId: number;
  homeName: string;
  awayName: string;
  live: boolean;
  onAdjust?: (side: 'home' | 'away', stat: 'corners' | 'shots' | 'sot', value: number) => void;
}

export function MatchStats({ stats, homeId, homeName, awayName, live, onAdjust }: Props) {
  const home = stats.find((s) => s.team.id === homeId) ?? stats[0];
  const away = stats.find((s) => s.team.id !== homeId) ?? stats[1];
  if (!home || !away) {
    return (
      <EmptyState
        icon="stats-chart-outline"
        title="İstatistik yok"
        subtitle={live ? 'İstatistikler maç başladıktan birkaç dakika sonra gelir.' : 'Bu maç için istatistik yayınlanmadı.'}
      />
    );
  }
  const get = (t: TeamStatistics, type: string) => t.statistics.find((s) => s.type === type)?.value;

  const rows = STAT_LABELS.map(([type, label]) => ({ type, label, h: get(home, type), a: get(away, type) })).filter(
    (r) => r.h !== undefined || r.a !== undefined,
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={[styles.teamName, { textAlign: 'left' }]} numberOfLines={1}>
          {homeName}
        </Text>
        <Text style={[styles.teamName, { textAlign: 'right' }]} numberOfLines={1}>
          {awayName}
        </Text>
      </View>
      {rows.map((r) => {
        const h = num(r.h);
        const a = num(r.a);
        const total = h + a;
        const hp = total > 0 ? h / total : 0.5;
        const stat = onAdjust ? ADJUSTABLE[r.type] : undefined;
        return (
          <View key={r.type} style={styles.row}>
            <View style={styles.values}>
              {stat ? (
                <Stepper value={fmt(r.h)} lead={h > a} onMinus={() => onAdjust!('home', stat, Math.max(0, h - 1))} onPlus={() => onAdjust!('home', stat, h + 1)} />
              ) : (
                <Text style={[styles.value, h > a && styles.valueLead]}>{fmt(r.h)}</Text>
              )}
              <Muted style={styles.label}>{r.label}</Muted>
              {stat ? (
                <Stepper value={fmt(r.a)} lead={a > h} align="right" onMinus={() => onAdjust!('away', stat, Math.max(0, a - 1))} onPlus={() => onAdjust!('away', stat, a + 1)} />
              ) : (
                <Text style={[styles.value, a > h && styles.valueLead, { textAlign: 'right' }]}>{fmt(r.a)}</Text>
              )}
            </View>
            <View style={styles.bar}>
              <View style={[styles.barHome, { flex: hp, opacity: h >= a ? 1 : 0.55 }]} />
              <View style={{ width: 3 }} />
              <View style={[styles.barAway, { flex: 1 - hp, opacity: a >= h ? 1 : 0.55 }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Stepper({
  value, lead, align, onMinus, onPlus,
}: {
  value: string;
  lead: boolean;
  align?: 'right';
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={[styles.step, align === 'right' && { justifyContent: 'flex-end' }]}>
      <Pressable onPress={onMinus} hitSlop={8} style={styles.stepBtn}>
        <Text style={styles.stepTxt}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, lead && styles.valueLead]}>{value}</Text>
      <Pressable onPress={onPlus} hitSlop={8} style={styles.stepBtn}>
        <Text style={styles.stepTxt}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  teamName: { color: colors.textMuted, fontSize: 12, fontWeight: '700', flex: 1 },
  row: { gap: 6 },
  values: { flexDirection: 'row', alignItems: 'center' },
  value: { color: colors.textMuted, fontSize: 14, fontWeight: '700', width: 64, fontVariant: ['tabular-nums'] },
  step: { width: 78, flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  stepValue: { color: colors.textMuted, fontSize: 14, fontWeight: '700', minWidth: 22, textAlign: 'center', fontVariant: ['tabular-nums'] },
  valueLead: { color: colors.text },
  label: { flex: 1, textAlign: 'center', fontSize: 12 },
  bar: { flexDirection: 'row', height: 6 },
  barHome: { backgroundColor: colors.primary, borderRadius: 3 },
  barAway: { backgroundColor: colors.info, borderRadius: 3 },
});
