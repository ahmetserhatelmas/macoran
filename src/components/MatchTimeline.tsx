import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState, Muted } from '@/components/ui';
import { narrateMatchEvent } from '@/lib/narration';
import type { FixtureEvent } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';

interface Props {
  events: FixtureEvent[];
  homeId: number;
  homeName: string;
  awayName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string;
  elapsed: number | null;
  extra?: number;
  live: boolean;
  finished: boolean;
}

type Kind = 'goal' | 'own' | 'pen' | 'penaward' | 'missed' | 'yellow' | 'red' | 'sub' | 'var' | 'injury' | 'woodwork' | 'chance' | 'save' | 'attack' | 'corner' | 'foul' | 'throwin' | 'offside' | 'goalkick' | 'stoppage' | 'other';

function classify(e: FixtureEvent): Kind {
  const d = (e.detail ?? '').toLowerCase();
  if (e.type === 'Goal') {
    if (d.includes('own')) return 'own';
    if (d.includes('missed')) return 'missed';
    if (d.includes('penalty')) return 'pen';
    return 'goal';
  }
  if (e.type === 'Card') return d.includes('red') ? 'red' : 'yellow';
  if (e.type === 'subst') return 'sub';
  if (e.type === 'Var') {
    if (d.includes('penalty awarded') || d.includes('penalty confirmed')) return 'penaward';
    return 'var';
  }
  if (e.type === 'Injury') return 'injury';
  if (e.type === 'Play') {
    if (d.includes('stoppage') || d.includes('uzatma')) return 'stoppage';
    if (d.includes('corner')) return 'corner';
    if (d.includes('foul')) return 'foul';
    if (d.includes('throw')) return 'throwin';
    if (d.includes('offside')) return 'offside';
    if (d.includes('goal kick')) return 'goalkick';
    return 'other';
  }
  if (e.type === 'Chance') {
    if (d.includes('wood')) return 'woodwork';
    if (d.includes('save')) return 'save';
    if (d.includes('attack')) return 'attack';
    return 'chance';
  }
  return 'other';
}

function minute(e: FixtureEvent) {
  return e.time.extra ? `${e.time.elapsed}+${e.time.extra}'` : `${e.time.elapsed}'`;
}


const ICON: Record<Kind, { name: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  goal: { name: 'football', color: colors.success },
  pen: { name: 'football', color: colors.success },
  penaward: { name: 'alert-circle', color: colors.gold },
  own: { name: 'football-outline', color: colors.danger },
  missed: { name: 'close-circle-outline', color: colors.danger },
  yellow: { name: 'square', color: colors.gold },
  red: { name: 'square', color: colors.danger },
  sub: { name: 'swap-horizontal', color: colors.info },
  var: { name: 'videocam-outline', color: colors.textMuted },
  injury: { name: 'medkit-outline', color: colors.danger },
  woodwork: { name: 'flash-outline', color: colors.gold },
  chance: { name: 'alert-circle-outline', color: colors.gold },
  save: { name: 'shield-outline', color: colors.info },
  attack: { name: 'flash-outline', color: colors.textMuted },
  stoppage: { name: 'time-outline', color: colors.gold },
  corner: { name: 'flag-outline', color: colors.info },
  foul: { name: 'warning-outline', color: colors.textMuted },
  throwin: { name: 'return-down-forward-outline', color: colors.textMuted },
  offside: { name: 'remove-circle-outline', color: colors.gold },
  goalkick: { name: 'arrow-undo-outline', color: colors.textMuted },
  other: { name: 'ellipse-outline', color: colors.textMuted },
};

export function MatchTimeline({ events, homeId, homeName, awayName, homeGoals, awayGoals, status, elapsed, extra = 0, live, finished }: Props) {
  if (!events.length) {
    return (
      <EmptyState
        icon="newspaper-outline"
        title={live ? 'Henüz olay yok' : 'Anlatım yok'}
        subtitle={live ? 'Gol, kart, korner, faul, taç ve tehlikeli anlar burada görünür.' : 'Bu maç için olay verisi yayınlanmadı.'}
      />
    );
  }

  // Olayları kronolojik sırala, skoru olay bazında yeniden hesapla
  const sorted = [...events].sort((x, y) => x.time.elapsed - y.time.elapsed || (x.time.extra ?? 0) - (y.time.extra ?? 0));
  let h = 0;
  let a = 0;
  const used = new Set<string>();
  const items = sorted.map((e, i) => {
    const kind = classify(e);
    let score: string | undefined;
    const scoringHome = kind === 'own' ? e.team.id !== homeId : e.team.id === homeId;
    if (kind === 'goal' || kind === 'pen' || kind === 'own') {
      if (scoringHome) h++;
      else a++;
      score = `${h}-${a}`;
    }
    const text = narrateMatchEvent(e, kind, score, scoringHome, used);
    return { key: `${i}-${e.time.elapsed}-${e.type}`, e, kind, text, home: e.team.id === homeId };
  });

  // En yeni üstte
  items.reverse();

  return (
    <View style={{ gap: spacing.sm }}>
      {finished ? (
        <Card muted>
          <Text style={styles.system}>Maç sona erdi. {homeName} {homeGoals ?? 0} - {awayGoals ?? 0} {awayName}.</Text>
        </Card>
      ) : live ? (
        <Card muted>
          <Text style={styles.system}>
            {status === 'HT' ? 'Devre arası.' : `${extra > 0 ? (status === '2H' ? `90+${extra}` : `45+${extra}`) : elapsed ?? 0}. dakika oynanıyor.`} Skor {homeGoals ?? 0} - {awayGoals ?? 0}.
          </Text>
        </Card>
      ) : null}

      {items.map(({ key, e, kind, text, home }) => {
        const icon = ICON[kind];
        const highlight = kind === 'goal' || kind === 'pen' || kind === 'penaward' || kind === 'own' || kind === 'red' || kind === 'woodwork' || kind === 'chance';
        return (
          <View key={key} style={[styles.item, highlight && styles.itemHighlight]}>
            <View style={styles.minuteCol}>
              <Text style={styles.minute}>{minute(e)}</Text>
              <Ionicons name={icon.name} size={16} color={icon.color} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.sideDot, { backgroundColor: home ? colors.primary : colors.info }]} />
                <Muted style={{ fontSize: 11 }}>{home ? homeName : awayName}</Muted>
              </View>
              <Text style={styles.text}>{text}</Text>
            </View>
          </View>
        );
      })}

      <Card muted>
        <Text style={styles.system}>Maç başladı. {homeName} - {awayName}.</Text>
      </Card>
    </View>
  );
}

function Card({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <View style={[styles.item, muted && { backgroundColor: 'transparent', borderStyle: 'dashed' }]}>{children}</View>;
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  itemHighlight: { borderColor: 'rgba(34,197,94,0.35)', borderWidth: 1 },
  minuteCol: { width: 44, alignItems: 'center', gap: 4 },
  minute: { color: colors.text, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] },
  sideDot: { width: 6, height: 6, borderRadius: 3 },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  system: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', flex: 1, textAlign: 'center' },
});
