import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Badge,
  Button,
  Header,
  IconButton,
  Input,
  Loading,
  Muted,
  Screen,
} from "@/components/ui";
import { ago, dayjs } from "@/lib/format";
import { formatSchedule, SCHEDULE_PRESETS, WEEKDAYS, type LeagueSchedule } from "@/lib/leagueSchedule";
import {
  simAdmin,
  type SimLeagueStatus,
  type SimSettingsRow,
  useSimStatus,
} from "@/lib/queries";
import { colors, radius, spacing } from "@/lib/theme";
import { useAuth } from "@/store/auth";

/** Hız ön ayarları: 1 maç dakikası = kaç saniye, devre arası */
const SPEED_PRESETS: {
  label: string;
  hint: string;
  spm: number;
  ht: number;
}[] = [
  { label: "Gerçek", hint: "90 dk + 15 dk ara", spm: 60, ht: 900 },
  { label: "Hızlı", hint: "~30 dk maç, 3 dk ara", spm: 20, ht: 180 },
  { label: "Çok hızlı", hint: "~8 dk maç, 1 dk ara", spm: 5, ht: 60 },
  { label: "Test", hint: "~3 dk maç, 20 sn ara", spm: 2, ht: 20 },
];

export default function SimAdminScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const { data, isLoading, refetch } = useSimStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<SimLeagueStatus | "all" | null>(null);
  const [scheduleLeague, setScheduleLeague] = useState<SimLeagueStatus | null>(null);

  useEffect(() => {
    if (isAdmin === false) router.replace("/(tabs)");
  }, [isAdmin, router]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["fixtures"] });
    qc.invalidateQueries({ queryKey: ["standings"] });
    qc.invalidateQueries({ queryKey: ["player-stats"] });
  };

  const run = async (
    key: string,
    action: string,
    body: Record<string, unknown>,
    done?: (r: Record<string, unknown>) => void,
  ) => {
    setBusy(key);
    try {
      const r = await simAdmin(action, body);
      done?.(r);
      await refetch();
      invalidateAll();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const settings = data?.settings;
  const leagues = data?.leagues ?? [];
  const started = leagues.filter((l) => l.sim_started_at);
  const testLive = data?.test_matches?.live ?? 0;
  const testCount = data?.test_matches?.count ?? 0;

  return (
    <Screen>
      <Header
        title="Simülasyon"
        subtitle="Lig motoru ve hız ayarları"
        left={<IconButton icon="chevron-back" onPress={() => router.back()} />}
      />
      {isLoading || !settings ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            paddingTop: 0,
            paddingBottom: 60,
            gap: spacing.lg,
          }}
        >
          {/* Motor durumu */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Motor</Text>
              <Badge
                text={
                  settings.last_tick_at &&
                  dayjs().diff(settings.last_tick_at, "second") < 60
                    ? "ÇALIŞIYOR"
                    : "BEKLİYOR"
                }
                color={
                  settings.last_tick_at &&
                  dayjs().diff(settings.last_tick_at, "second") < 60
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(239,68,68,0.15)"
                }
                textColor={
                  settings.last_tick_at &&
                  dayjs().diff(settings.last_tick_at, "second") < 60
                    ? colors.success
                    : colors.danger
                }
                dot
              />
            </View>
            <Muted style={{ fontSize: 12 }}>
              Son tur:{" "}
              {settings.last_tick_at ? ago(settings.last_tick_at) : "—"}
              {settings.last_tick_message
                ? ` · ${settings.last_tick_message}`
                : ""}
            </Muted>
            <Muted style={{ fontSize: 12 }}>
              Başlatılan lig: {started.length} · Motor her 15 saniyede bir
              çalışır; saati gelen maçlar otomatik başlar.
            </Muted>
            <Button
              title="Canlı skora müdahale"
              size="sm"
              icon="football"
              onPress={() => router.push("/admin/live")}
            />
            <Button
              title="Test maçları başlat"
              size="sm"
              icon="flask"
              variant="secondary"
              loading={busy === "test-matches"}
              onPress={() =>
                run("test-matches", "start_test_matches", {}, (r) => {
                  const matches = (r.matches as { home: string; away: string }[]) ?? [];
                  Alert.alert(
                    "Test maçları",
                    `${matches.length} rastgele maç canlı açıldı. Puan durumu ve krallıklara yazılmaz. Canlı sekmesinde “Test Maçları” olarak görünür.`,
                  );
                })
              }
            />
            {testCount > 0 ? (
              <Button
                title={testLive ? `Test maçlarını durdur (${testLive})` : "Test maçlarını durdur"}
                size="sm"
                icon="stop"
                variant="danger"
                loading={busy === "test-stop"}
                onPress={() =>
                  Alert.alert(
                    "Test maçlarını durdur",
                    "Açık test maçları iptal edilir, bekleyen kuponlar iade edilir.",
                    [
                      { text: "Vazgeç", style: "cancel" },
                      {
                        text: "Durdur",
                        style: "destructive",
                        onPress: () =>
                          run("test-stop", "stop_test_matches", {}, (r) => {
                            Alert.alert("Test maçları durdu", `${Number(r.archived ?? 0)} maç kapatıldı.`);
                          }),
                      },
                    ],
                  )
                }
              />
            ) : null}
          </View>

          {/* Hız */}
          <SpeedCard
            key={`${settings.seconds_per_minute}-${settings.halftime_seconds}-${settings.goal_suspend_seconds}-${settings.margin}-${settings.live_margin}`}
            settings={settings}
            busy={busy === "settings"}
            onSave={(patch) => run("settings", "update_settings", patch)}
          />

          {/* Ligler */}
          <View style={{ gap: spacing.sm }}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Ligler</Text>
              <View style={{ flexDirection: "row", gap: 8, flexShrink: 1 }}>
                {leagues.some((l) => !l.sim_started_at) ? (
                  <Button
                    title="Hepsini başlat"
                    size="sm"
                    icon="play"
                    loading={busy === "league-all"}
                    onPress={() => setStartTarget("all")}
                  />
                ) : null}
                {started.length ? (
                  <Button
                    title="Hepsini durdur"
                    size="sm"
                    icon="stop"
                    variant="danger"
                    loading={busy === "league-stop-all"}
                    onPress={() =>
                      Alert.alert(
                        "Tüm ligleri durdur",
                        `${started.length} aktif lig durdurulacak. Oynanmamış maçlar iptal edilir, bekleyen kuponlar iade edilir.`,
                        [
                          { text: "Vazgeç", style: "cancel" },
                          {
                            text: "Hepsini durdur",
                            style: "destructive",
                            onPress: () =>
                              run("league-stop-all", "stop_leagues", {}, (r) => {
                                const stopped = (r.stopped as { name: string }[]) ?? [];
                                const failed = (r.failed as { name: string; error: string }[]) ?? [];
                                const lines = [
                                  `${stopped.length} lig durduruldu.`,
                                  failed.length
                                    ? `Durmayan: ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}`
                                    : "",
                                ].filter(Boolean);
                                Alert.alert(failed.length ? "Kısmen durdu" : "Ligler durdu", lines.join("\n"));
                              }),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
              </View>
            </View>
            {leagues.map((l) => (
              <LeagueRow
                key={l.id}
                league={l}
                busy={busy === `league-${l.id}`}
                onStart={() => setStartTarget(l)}
                onStop={() =>
                  Alert.alert(
                    "Ligi durdur",
                    `${l.name} durdurulacak. Oynanmamış maçlar iptal edilir, bekleyen kuponlar iade edilir.`,
                    [
                      { text: "Vazgeç", style: "cancel" },
                      {
                        text: "Durdur",
                        style: "destructive",
                        onPress: () =>
                          run(`league-${l.id}`, "stop_league", {
                            league_id: l.id,
                          }),
                      },
                    ],
                  )
                }
                onScenario={() => router.push(`/admin/scenario/${l.id}`)}
                onSchedule={() => setScheduleLeague(l)}
                onDates={() => router.push(`/admin/dates/${l.id}`)}
              />
            ))}
          </View>
        </ScrollView>
      )}

      <StartLeagueModal
        target={startTarget}
        pendingCount={leagues.filter((l) => !l.sim_started_at).length}
        busy={busy === (startTarget === "all" ? "league-all" : `league-${startTarget?.id ?? ""}`)}
        onClose={() => setStartTarget(null)}
        onStart={(body) => {
          if (startTarget === "all") {
            setBusy("league-all");
            void (async () => {
              const startedNames: string[] = [];
              const realFail: { name: string; error: string }[] = [];
              let skippedN = 0;
              try {
                for (let i = 0; i < 12; i++) {
                  const r = await simAdmin("start_leagues", body);
                  const batch = (r.started as { name: string }[]) ?? [];
                  startedNames.push(...batch.map((x) => x.name));
                  skippedN = Math.max(skippedN, ((r.skipped as unknown[]) ?? []).length);
                  const failed = (r.failed as { name: string; error: string }[]) ?? [];
                  realFail.push(...failed.filter((f) => f.error !== "süre doldu"));
                  const more = failed.some((f) => f.error === "süre doldu") || Number(r.remaining ?? 0) > 0;
                  await refetch();
                  if (!more) break;
                }
                setStartTarget(null);
                invalidateAll();
                const lines = [
                  `${startedNames.length} lig başlatıldı.`,
                  skippedN ? `${skippedN} zaten aktifti.` : "",
                  realFail.length ? `Başlamayan: ${realFail.map((f) => `${f.name} (${f.error})`).join(", ")}` : "",
                ].filter(Boolean);
                Alert.alert(realFail.length ? "Kısmen başladı" : "Ligler başlatıldı", lines.join("\n") || "Tamam.");
              } catch (e) {
                await refetch();
                Alert.alert("Hata", e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            })();
            return;
          }
          const l = startTarget!;
          run(
            `league-${l.id}`,
            "start_league",
            { league_id: l.id, ...body },
            (r) => {
              setStartTarget(null);
              const cal = r.calendar === "api" ? "gerçek sezon fikstürü" : "lig ritmi (tahmini)";
              Alert.alert(
                "Lig başlatıldı",
                `${l.name}: ${r.teams} takım, ${r.fixtures} maç, ${r.rounds} hafta (${cal}).\nKadro: API ${(r.squads as { imported?: number })?.imported ?? 0}, sentetik ${(r.squads as { synthetic?: number })?.synthetic ?? 0}.`,
              );
            },
          );
        }}
      />
      <ScheduleModal
        league={scheduleLeague}
        busy={busy === (scheduleLeague ? `sched-${scheduleLeague.id}` : "")}
        onClose={() => setScheduleLeague(null)}
        onSave={(leagueId, schedule) =>
          run(`sched-${leagueId}`, "set_schedule", { league_id: leagueId, schedule }, (r) => {
            setScheduleLeague(null);
            const n = Number(r.moved ?? 0);
            Alert.alert(
              "Takvim kaydedildi",
              n
                ? `${n} başlamamış maç yeni gün/saate alındı.`
                : "Kayıtlı. Lig başlatınca bu gün ve saatler kullanılır.",
            );
          })
        }
      />
    </Screen>
  );
}

function SpeedCard({
  settings,
  busy,
  onSave,
}: {
  settings: SimSettingsRow;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [spm, setSpm] = useState(String(settings.seconds_per_minute));
  const [ht, setHt] = useState(String(settings.halftime_seconds));
  const [susp, setSusp] = useState(String(settings.goal_suspend_seconds));
  const [margin, setMargin] = useState(
    String(Math.round(Number(settings.margin) * 100)),
  );
  const [liveMargin, setLiveMargin] = useState(
    String(Math.round(Number(settings.live_margin) * 100)),
  );

  const matchMinutes = Math.round(
    (95 * Number(spm || 0) + Number(ht || 0)) / 60,
  );
  const dirty =
    Number(spm) !== Number(settings.seconds_per_minute) ||
    Number(ht) !== Number(settings.halftime_seconds) ||
    Number(susp) !== Number(settings.goal_suspend_seconds) ||
    Number(margin) !== Math.round(Number(settings.margin) * 100) ||
    Number(liveMargin) !== Math.round(Number(settings.live_margin) * 100);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Maç hızı</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {SPEED_PRESETS.map((p) => {
          const active = Number(spm) === p.spm && Number(ht) === p.ht;
          return (
            <Pressable
              key={p.label}
              onPress={() => {
                setSpm(String(p.spm));
                setHt(String(p.ht));
              }}
              style={[styles.preset, active && styles.presetActive]}
            >
              <Text
                style={[
                  styles.presetText,
                  active && { color: colors.primaryText },
                ]}
              >
                {p.label}
              </Text>
              <Text
                style={[
                  styles.presetHint,
                  active && { color: colors.primaryText },
                ]}
              >
                {p.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="1 maç dk = sn"
            value={spm}
            onChangeText={setSpm}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Devre arası (sn)"
            value={ht}
            onChangeText={setHt}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Gol askısı (sn)"
            value={susp}
            onChangeText={setSusp}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Maç öncesi marj %"
            value={margin}
            onChangeText={setMargin}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Canlı marj %"
            value={liveMargin}
            onChangeText={setLiveMargin}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <Muted style={{ fontSize: 12 }}>
        Bir maç yaklaşık {matchMinutes} dakika sürer. Değişiklik yalnızca yeni
        başlayan maçların saatini etkilemez; canlı maçlar da yeni hıza geçer.
      </Muted>
      <Button
        title="Kaydet"
        disabled={!dirty}
        loading={busy}
        onPress={() =>
          onSave({
            seconds_per_minute: Number(spm),
            halftime_seconds: Number(ht),
            goal_suspend_seconds: Number(susp),
            margin: Number(margin) / 100,
            live_margin: Number(liveMargin) / 100,
          })
        }
      />
    </View>
  );
}

function LeagueRow({
  league: l,
  busy,
  onStart,
  onStop,
  onScenario,
  onSchedule,
  onDates,
}: {
  league: SimLeagueStatus;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onScenario: () => void;
  onSchedule: () => void;
  onDates: () => void;
}) {
  const running = !!l.sim_started_at;
  const sched = (l.sim_schedule ?? l.schedule_default) as LeagueSchedule | undefined;
  return (
    <View style={styles.leagueRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.leagueName} numberOfLines={1}>
            {l.name}
          </Text>
          {running ? (
            <Badge
              text="AKTİF"
              color="rgba(34,197,94,0.15)"
              textColor={colors.success}
              dot
            />
          ) : null}
        </View>
        <Muted style={{ fontSize: 11 }}>
          {l.teams} takım · {l.players} oyuncu
          {running
            ? ` · ${l.played} oynandı / ${l.upcoming} kalan · ${l.sim_config?.rounds ?? "?"} hafta${l.sim_config?.calendar === "api" ? " · gerçek fikstür" : ""}`
            : ""}
        </Muted>
        <Muted style={{ fontSize: 11 }}>{formatSchedule(sched ?? null)}</Muted>
        {running && l.sim_started_at ? (
          <Muted style={{ fontSize: 11 }}>
            Başladı {ago(l.sim_started_at)}
          </Muted>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Pressable onPress={onSchedule} style={styles.iconBtn} accessibilityLabel="Gün ve saat">
          <Ionicons name="time-outline" size={18} color={colors.text} />
        </Pressable>
        {running ? (
          <>
            <Pressable onPress={onDates} style={styles.iconBtn} accessibilityLabel="Maç tarihi">
              <Ionicons name="calendar-outline" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={onScenario}
              style={styles.iconBtn}
              accessibilityLabel="Senaryo"
            >
              <Ionicons name="create-outline" size={18} color={colors.text} />
            </Pressable>
            <Button
              title="Durdur"
              variant="danger"
              size="sm"
              loading={busy}
              onPress={onStop}
            />
          </>
        ) : (
          <Button
            title="Ligi başlat"
            size="sm"
            icon="play"
            loading={busy}
            onPress={onStart}
          />
        )}
      </View>
    </View>
  );
}

function ScheduleModal({
  league,
  busy,
  onClose,
  onSave,
}: {
  league: SimLeagueStatus | null;
  busy: boolean;
  onClose: () => void;
  onSave: (leagueId: number, schedule: LeagueSchedule) => void;
}) {
  return (
    <Modal visible={!!league} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {league ? (
          <ScheduleForm
            key={league.id}
            league={league}
            busy={busy}
            onClose={onClose}
            onSave={onSave}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ScheduleForm({
  league,
  busy,
  onClose,
  onSave,
}: {
  league: SimLeagueStatus;
  busy: boolean;
  onClose: () => void;
  onSave: (leagueId: number, schedule: LeagueSchedule) => void;
}) {
  const initial = (league.sim_schedule ?? league.schedule_default ?? {
    days: [5, 6, 7],
    hour_from: 16,
    hour_to: 22,
  }) as LeagueSchedule;
  const [days, setDays] = useState<number[]>(initial.days);
  const [fromH, setFromH] = useState(initial.hour_from);
  const [toH, setToH] = useState(initial.hour_to);

  const toggle = (d: number) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  };
  const bump = (which: "from" | "to", dir: -1 | 1) => {
    if (which === "from") setFromH((h) => Math.max(0, Math.min(23, h + dir)));
    else setToH((h) => Math.max(0, Math.min(23, h + dir)));
  };
  const valid = days.length > 0 && fromH <= toH;

  return (
    <View style={styles.modal}>
      <Text style={styles.modalTitle}>{league.name}</Text>
      <Muted style={{ fontSize: 12 }}>
        Maç günleri ve kickoff aralığı (Türkiye saati). Lig açıksa başlamamış maçlar buna göre kayar.
      </Muted>
      <Text style={styles.fieldLabel}>Günler</Text>
      <View style={styles.dayRow}>
        {WEEKDAYS.map((w) => {
          const on = days.includes(w.d);
          return (
            <Pressable
              key={w.d}
              onPress={() => toggle(w.d)}
              style={[styles.dayChip, on && styles.dayChipOn]}
            >
              <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{w.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.fieldLabel}>Saat aralığı (TR)</Text>
      <View style={styles.hourRow}>
        <HourStepper label="Başlangıç" value={fromH} onBump={(d) => bump("from", d)} />
        <Text style={{ color: colors.textMuted, fontWeight: "700" }}>—</Text>
        <HourStepper label="Bitiş" value={toH} onBump={(d) => bump("to", d)} />
      </View>
      {fromH > toH ? (
        <Muted style={{ fontSize: 11, color: colors.danger }}>Bitiş, başlangıçtan küçük olamaz.</Muted>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {SCHEDULE_PRESETS.map((p) => (
          <Pressable
            key={p.label}
            onPress={() => {
              setDays(p.days);
              setFromH(p.hour_from);
              setToH(p.hour_to);
            }}
            style={styles.presetChip}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="Vazgeç" variant="ghost" style={{ flex: 1 }} onPress={onClose} />
        <Button
          title="Kaydet"
          icon="checkmark"
          style={{ flex: 1 }}
          loading={busy}
          disabled={!valid}
          onPress={() => onSave(league.id, { days, hour_from: fromH, hour_to: toH })}
        />
      </View>
    </View>
  );
}

function HourStepper({
  label,
  value,
  onBump,
}: {
  label: string;
  value: number;
  onBump: (dir: -1 | 1) => void;
}) {
  const hh = `${String(value).padStart(2, "0")}:00`;
  return (
    <View style={{ alignItems: "center", gap: 6, flex: 1 }}>
      <Muted style={{ fontSize: 11 }}>{label}</Muted>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable onPress={() => onBump(-1)} style={styles.stepBtn} hitSlop={8}>
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.hourValue}>{hh}</Text>
        <Pressable onPress={() => onBump(1)} style={styles.stepBtn} hitSlop={8}>
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function StartLeagueModal({
  target,
  pendingCount,
  busy,
  onClose,
  onStart,
}: {
  target: SimLeagueStatus | "all" | null;
  pendingCount: number;
  busy: boolean;
  onClose: () => void;
  onStart: (body: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      visible={!!target}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {target ? (
          <StartLeagueForm
            key={target === "all" ? "all" : target.id}
            title={target === "all" ? `Hepsini başlat (${pendingCount} lig)` : `${target.name} — Ligi başlat`}
            teams={target === "all" ? 0 : target.teams}
            all={target === "all"}
            busy={busy}
            onClose={onClose}
            onStart={onStart}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StartLeagueForm({
  title,
  teams,
  all,
  busy,
  onClose,
  onStart,
}: {
  title: string;
  teams: number;
  all: boolean;
  busy: boolean;
  onClose: () => void;
  onStart: (body: Record<string, unknown>) => void;
}) {
  const [startAt, setStartAt] = useState(() =>
    dayjs().add(10, "minute").format("YYYY-MM-DD HH:mm"),
  );
  const [fastTest, setFastTest] = useState(false);
  const [interval, setInterval] = useState("2");
  const [times, setTimes] = useState("14:00, 17:00, 20:00");
  const [double, setDouble] = useState(true);

  const parsedStart = dayjs(startAt, "YYYY-MM-DD HH:mm", true);
  const timesOk = times
    .split(",")
    .map((t) => t.trim())
    .every((t) => /^\d{1,2}:\d{2}$/.test(t));
  const valid = parsedStart.isValid() && (!fastTest || (Number(interval) >= 1 && timesOk));
  const kickoffTimes = times
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const rounds = teams
    ? (teams % 2 === 0 ? teams - 1 : teams) * (double ? 2 : 1)
    : 0;

  return (
    <View style={styles.modal}>
      <Text style={styles.modalTitle}>{title}</Text>
      <Muted style={{ fontSize: 12 }}>
        {all
          ? "Her lig bu sezonun gerçek fikstürünü (eşleşmeler) alır; gün/saat lig ritmine göre yayılır: Avrupa ligleri öğleden sonra–akşam, Brezilya/MLS gece, Japonya gündüz. UEFA kulüp kupaları hafta sonuna kilitlenir. Kadrolar API-Football'dan çekilir."
          : "Bu sezonun gerçek fikstürü kullanılır (kim kiminle, hangi gün/saat). İlk hafta aşağıdaki tarihe kaydırılır; 10. hafta gibi günü net olmayan maçlar ligin tipik günlerine göre yerleştirilir."}
      </Muted>
      <Input
        label="Sezon başlangıcı (YYYY-AA-GG SS:DD)"
        value={startAt}
        onChangeText={setStartAt}
        autoCapitalize="none"
      />
      <Pressable
        onPress={() => setFastTest(!fastTest)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Ionicons
          name={fastTest ? "checkbox" : "square-outline"}
          size={20}
          color={fastTest ? colors.primary : colors.textMuted}
        />
        <Text style={{ color: colors.text, fontSize: 13 }}>
          Hızlı test takvimi (her güne maç)
        </Text>
      </Pressable>
      {fastTest ? (
        <>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Input
                label="Haftalar arası (saat)"
                value={interval}
                onChangeText={setInterval}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 2 }}>
              <Input
                label="Maç saatleri (TR)"
                value={times}
                onChangeText={setTimes}
                autoCapitalize="none"
              />
            </View>
          </View>
          <Pressable
            onPress={() => setDouble(!double)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Ionicons
              name={double ? "checkbox" : "square-outline"}
              size={20}
              color={double ? colors.primary : colors.textMuted}
            />
            <Text style={{ color: colors.text, fontSize: 13 }}>
              Çift devreli (iç saha + deplasman)
            </Text>
          </Pressable>
          {teams ? (
            <Muted style={{ fontSize: 12 }}>
              {teams} takım → {rounds} hafta, {(teams / 2) | 0} maç/hafta.
            </Muted>
          ) : null}
        </>
      ) : (
        <Muted style={{ fontSize: 12 }}>
          Süper Lig, 1. Lig, Championship, Ligue 2 gibi ligler Pazartesi–
          Salı dahil her gün dolar; saatler akşama yayılır. UEFA kupaları
          hafta sonu. Başlatınca ilk maçlar bugünden (şimdiden sonra) yazılır.
        </Muted>
      )}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          title="Vazgeç"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={onClose}
        />
        <Button
          title="Başlat"
          icon="play"
          style={{ flex: 1 }}
          loading={busy}
          disabled={!valid}
          onPress={() =>
            onStart(
              fastTest
                ? {
                    start_at: parsedStart.toISOString(),
                    use_real_calendar: false,
                    round_interval_hours: Number(interval),
                    kickoff_times: kickoffTimes,
                    double_round: double,
                  }
                : {
                    start_at: parsedStart.toISOString(),
                    use_real_calendar: true,
                  },
            )
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 14 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  preset: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    gap: 1,
  },
  presetActive: { backgroundColor: colors.primary },
  presetText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  presetHint: { color: colors.textMuted, fontSize: 10 },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  leagueName: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 14,
    flexShrink: 1,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  dayChipTextOn: { color: colors.primaryText },
  hourRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  hourValue: { color: colors.text, fontWeight: "800", fontSize: 18, minWidth: 58, textAlign: "center" },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
  },
});
