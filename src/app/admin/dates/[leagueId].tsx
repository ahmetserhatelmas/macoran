import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TeamLogo } from "@/components/TeamLogo";
import {
  Button,
  EmptyState,
  Header,
  IconButton,
  Input,
  Loading,
  Muted,
  Screen,
} from "@/components/ui";
import { dateTime, dayjs } from "@/lib/format";
import { simAdmin, useLeagues, useUpcomingSimFixtures } from "@/lib/queries";
import { colors, radius, spacing } from "@/lib/theme";
import { useAuth } from "@/store/auth";

type Upcoming = NonNullable<ReturnType<typeof useUpcomingSimFixtures>["data"]>[number];

export default function FixtureDatesScreen() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const id = Number(leagueId);
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const { data: leagues = [] } = useLeagues();
  const league = leagues.find((l) => l.id === id);
  const { data: fixtures = [], isLoading, refetch } = useUpcomingSimFixtures(id, 250);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Upcoming | null>(null);

  useEffect(() => {
    if (isAdmin === false) router.replace("/(tabs)");
  }, [isAdmin, router]);

  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr-TR");
    if (!s) return fixtures;
    return fixtures.filter(
      (f) =>
        f.home.name.toLocaleLowerCase("tr-TR").includes(s) ||
        f.away.name.toLocaleLowerCase("tr-TR").includes(s) ||
        (f.round ?? "").toLocaleLowerCase("tr-TR").includes(s),
    );
  }, [fixtures, q]);

  const save = async (date: string) => {
    if (!target) return;
    try {
      await simAdmin("set_fixture_date", { fixture_id: target.id, date });
      setTarget(null);
      await refetch();
      qc.invalidateQueries({ queryKey: ["fixtures"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Header
        title="Maç tarihi"
        subtitle={league?.name ?? "Yaklaşan maçlar"}
        left={<IconButton icon="chevron-back" onPress={() => router.back()} />}
      />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(f) => String(f.id)}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 40, gap: spacing.sm }}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
              <Muted style={{ fontSize: 12 }}>
                Bir maça dokunup gün ve saati yazın (Türkiye saati). Sadece başlamamış maçlar taşınır.
              </Muted>
              <Input placeholder="Takım veya hafta ara" value={q} onChangeText={setQ} icon="search" />
            </View>
          }
          renderItem={({ item: f }) => (
            <Pressable
              onPress={() => setTarget(f)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Muted style={{ fontSize: 11 }}>
                  {f.round ?? ""} · {dateTime(f.date)}
                </Muted>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <TeamLogo uri={f.home.logo} size={18} name={f.home.name} />
                  <Text style={styles.team} numberOfLines={1}>
                    {f.home.name}
                  </Text>
                  <Text style={styles.vs}>-</Text>
                  <Text style={[styles.team, { textAlign: "right" }]} numberOfLines={1}>
                    {f.away.name}
                  </Text>
                  <TeamLogo uri={f.away.logo} size={18} name={f.away.name} />
                </View>
              </View>
              <Ionicons name="calendar-outline" size={18} color={colors.textDim} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Yaklaşan maç yok"
              subtitle="Bu lig başlatılmamış ya da tüm maçlar oynanmış."
            />
          }
        />
      )}

      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTarget(null)} />
          {target ? (
            <DateForm key={target.id} fixture={target} onClose={() => setTarget(null)} onSave={save} />
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function DateForm({
  fixture: f,
  onClose,
  onSave,
}: {
  fixture: Upcoming;
  onClose: () => void;
  onSave: (date: string) => Promise<void>;
}) {
  const [value, setValue] = useState(() => dayjs(f.date).format("YYYY-MM-DD HH:mm"));
  const [busy, setBusy] = useState(false);
  const parsed = dayjs(value, "YYYY-MM-DD HH:mm", true);
  const valid = parsed.isValid() && parsed.isAfter(dayjs().subtract(1, "minute"));

  const applyDay = (offset: number) => {
    const time = parsed.isValid() ? parsed.format("HH:mm") : dayjs(f.date).format("HH:mm");
    setValue(`${dayjs().add(offset, "day").format("YYYY-MM-DD")} ${time}`);
  };

  return (
    <View style={styles.modal}>
      <Text style={styles.modalTitle}>
        {f.home.name} - {f.away.name}
      </Text>
      <Muted style={{ fontSize: 12 }}>
        {f.round ?? ""} · şu an {dateTime(f.date)}
      </Muted>
      <Input label="Kickoff (YYYY-AA-GG SS:DD)" value={value} onChangeText={setValue} autoCapitalize="none" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          { label: "Bugün", n: 0 },
          { label: "Yarın", n: 1 },
          { label: "+2 gün", n: 2 },
          { label: "+3 gün", n: 3 },
        ].map((p) => (
          <Pressable key={p.label} onPress={() => applyDay(p.n)} style={styles.chip}>
            <Text style={styles.chipText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {!valid ? (
        <Muted style={{ fontSize: 11, color: colors.danger }}>Geçerli ve gelecekte bir tarih yazın.</Muted>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="Vazgeç" variant="ghost" style={{ flex: 1 }} onPress={onClose} />
        <Button
          title="Taşı"
          icon="calendar"
          style={{ flex: 1 }}
          loading={busy}
          disabled={!valid}
          onPress={async () => {
            setBusy(true);
            await onSave(value);
            setBusy(false);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  team: { color: colors.text, fontWeight: "700", fontSize: 13, flex: 1 },
  vs: { color: colors.textMuted, fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
  },
  chipText: { color: colors.text, fontWeight: "700", fontSize: 12 },
});
