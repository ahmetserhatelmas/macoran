import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
  Badge,
  Button,
  EmptyState,
  Header,
  IconButton,
  Input,
  Loading,
  Muted,
  Screen,
} from "@/components/ui";
import { dateTime } from "@/lib/format";
import { simAdmin, useLeagues, useUpcomingSimFixtures } from "@/lib/queries";
import { colors, radius, spacing } from "@/lib/theme";
import { useAuth } from "@/store/auth";

type Upcoming = NonNullable<
  ReturnType<typeof useUpcomingSimFixtures>["data"]
>[number];

/**
 * Senaryo editörü: yaklaşan maçlar için ilk yarı ve maç sonu skorunu yazın;
 * motor maçı bu skorlarla oynar (golleri uygun oyuncular atar).
 */
export default function ScenarioScreen() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const id = Number(leagueId);
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const { data: leagues = [] } = useLeagues();
  const league = leagues.find((l) => l.id === id);
  const {
    data: fixtures = [],
    isLoading,
    refetch,
  } = useUpcomingSimFixtures(id);
  const [target, setTarget] = useState<Upcoming | null>(null);

  useEffect(() => {
    if (isAdmin === false) router.replace("/(tabs)");
  }, [isAdmin, router]);

  const save = async (body: Record<string, unknown> | null) => {
    if (!target) return;
    try {
      if (body)
        await simAdmin("set_scenario", { fixture_id: target.id, ...body });
      else await simAdmin("clear_scenario", { fixture_id: target.id });
      setTarget(null);
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Header
        title="Senaryo"
        subtitle={league?.name ?? "Yaklaşan maçlar"}
        left={<IconButton icon="chevron-back" onPress={() => router.back()} />}
      />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={fixtures}
          keyExtractor={(f) => String(f.id)}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingTop: 0,
            paddingBottom: 40,
            gap: spacing.sm,
          }}
          ListHeaderComponent={
            <Muted style={{ fontSize: 12, marginBottom: spacing.sm }}>
              Bir maça dokunup ilk yarı ve maç sonu skorunu yazın. Senaryo
              yazılan maçlar işaretlenir; oranlar bundan etkilenmez.
            </Muted>
          }
          renderItem={({ item: f }) => {
            const sc = f.sim_matches?.scenario;
            return (
              <Pressable
                onPress={() => setTarget(f)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.85 },
                  sc && styles.rowScripted,
                ]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Muted style={{ fontSize: 11 }}>
                    {f.round ?? ""} · {dateTime(f.date)}
                  </Muted>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <TeamLogo uri={f.home.logo} size={18} name={f.home.name} />
                    <Text style={styles.team} numberOfLines={1}>
                      {f.home.name}
                    </Text>
                    <Text style={styles.vs}>-</Text>
                    <Text
                      style={[styles.team, { textAlign: "right" }]}
                      numberOfLines={1}
                    >
                      {f.away.name}
                    </Text>
                    <TeamLogo uri={f.away.logo} size={18} name={f.away.name} />
                  </View>
                </View>
                {sc ? (
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <Badge
                      text={`İY ${sc.ht_home}-${sc.ht_away} · MS ${sc.ft_home}-${sc.ft_away}`}
                      color="rgba(251,191,36,0.15)"
                      textColor={colors.gold}
                    />
                    {sc.note ? (
                      <Muted style={{ fontSize: 10 }} numberOfLines={1}>
                        {sc.note}
                      </Muted>
                    ) : null}
                  </View>
                ) : (
                  <Ionicons
                    name="create-outline"
                    size={18}
                    color={colors.textDim}
                  />
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Yaklaşan maç yok"
              subtitle="Bu lig başlatılmamış ya da tüm maçlar oynanmış."
            />
          }
        />
      )}

      <Modal
        visible={!!target}
        transparent
        animationType="fade"
        onRequestClose={() => setTarget(null)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalBg}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setTarget(null)}
          />
          {target ? (
            <ScenarioForm key={target.id} fixture={target} onSave={save} />
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function ScenarioForm({
  fixture: f,
  onSave,
}: {
  fixture: Upcoming;
  onSave: (body: Record<string, unknown> | null) => Promise<void>;
}) {
  const sc = f.sim_matches?.scenario;
  const [hth, setHth] = useState(String(sc?.ht_home ?? 0));
  const [hta, setHta] = useState(String(sc?.ht_away ?? 0));
  const [fth, setFth] = useState(String(sc?.ft_home ?? 0));
  const [fta, setFta] = useState(String(sc?.ft_away ?? 0));
  const [note, setNote] = useState(sc?.note ?? "");
  const [busy, setBusy] = useState(false);

  const n = (s: string) =>
    Math.max(0, Math.min(12, parseInt(s || "0", 10) || 0));
  const invalid = n(fth) < n(hth) || n(fta) < n(hta);

  const submit = async (clear: boolean) => {
    setBusy(true);
    await onSave(
      clear
        ? null
        : {
            ht_home: n(hth),
            ht_away: n(hta),
            ft_home: n(fth),
            ft_away: n(fta),
            note: note.trim() || undefined,
          },
    );
    setBusy(false);
  };

  return (
    <View style={styles.modal}>
      <Text style={styles.modalTitle}>
        {f.home.name} - {f.away.name}
      </Text>
      <Muted style={{ fontSize: 12 }}>
        {f.round ?? ""} · {dateTime(f.date)}
      </Muted>

      <Text style={styles.label}>İlk yarı skoru</Text>
      <ScoreInputs
        h={hth}
        a={hta}
        onH={setHth}
        onA={setHta}
        homeName={f.home.name}
        awayName={f.away.name}
      />
      <Text style={styles.label}>Maç sonu skoru</Text>
      <ScoreInputs
        h={fth}
        a={fta}
        onH={setFth}
        onA={setFta}
        homeName={f.home.name}
        awayName={f.away.name}
      />
      {invalid ? (
        <Text style={{ color: colors.danger, fontSize: 12 }}>
          Maç sonu skoru ilk yarıdan küçük olamaz.
        </Text>
      ) : null}
      <Input
        placeholder="Not (isteğe bağlı)"
        value={note}
        onChangeText={setNote}
      />

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {f.sim_matches?.scenario ? (
          <Button
            title="Senaryoyu sil"
            variant="danger"
            style={{ flex: 1 }}
            loading={busy}
            onPress={() => submit(true)}
          />
        ) : null}
        <Button
          title="Kaydet"
          style={{ flex: 1 }}
          loading={busy}
          disabled={invalid}
          onPress={() => submit(false)}
        />
      </View>
    </View>
  );
}

function ScoreInputs({
  h,
  a,
  onH,
  onA,
  homeName,
  awayName,
}: {
  h: string;
  a: string;
  onH: (v: string) => void;
  onA: (v: string) => void;
  homeName: string;
  awayName: string;
}) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
    >
      <View style={{ flex: 1 }}>
        <Input
          value={h}
          onChangeText={onH}
          keyboardType="number-pad"
          maxLength={2}
          style={{ textAlign: "center", fontSize: 20, fontWeight: "800" }}
        />
        <Muted
          style={{ fontSize: 10, textAlign: "center", marginTop: 4 }}
          numberOfLines={1}
        >
          {homeName}
        </Muted>
      </View>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 20,
          fontWeight: "800",
          marginBottom: 16,
        }}
      >
        -
      </Text>
      <View style={{ flex: 1 }}>
        <Input
          value={a}
          onChangeText={onA}
          keyboardType="number-pad"
          maxLength={2}
          style={{ textAlign: "center", fontSize: 20, fontWeight: "800" }}
        />
        <Muted
          style={{ fontSize: 10, textAlign: "center", marginTop: 4 }}
          numberOfLines={1}
        >
          {awayName}
        </Muted>
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
  rowScripted: { borderColor: "rgba(251,191,36,0.5)", borderWidth: 1 },
  team: { color: colors.text, fontWeight: "700", fontSize: 13, flex: 1 },
  vs: { color: colors.textDim, fontWeight: "700" },
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
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
});
