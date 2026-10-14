import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { search, snap } from "./src/api";
import { OfferCard } from "./src/components/OfferCard";
import { useTheme, type Theme } from "./src/theme";
import type { GeoPoint, Preference, SearchResult, SnapResult } from "./src/types";

const MAX_SIDE = 1600;

const PREFS: Array<{ value: Preference; label: string }> = [
  { value: "balanced", label: "Best overall" },
  { value: "cheapest", label: "Cheapest" },
  { value: "fastest", label: "Get it fast" },
];

type Screen = "capture" | "loading" | "results";

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const t = useTheme();
  const s = styles(t);
  const scroll = useRef<ScrollView>(null);

  const [screen, setScreen] = useState<Screen>("capture");
  const [photo, setPhoto] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [prefer, setPrefer] = useState<Preference>("balanced");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locStatus, setLocStatus] = useState("Off: online results only");
  const [error, setError] = useState("");
  const [loadingText, setLoadingText] = useState("");
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [refining, setRefining] = useState(false);

  // ---------- photo ----------

  async function pick(source: "camera" | "library") {
    setError("");
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        source === "camera" ? "Allow camera access to take a photo." : "Allow photo access to pick a photo.",
        [{ text: "Cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
      );
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.9 };
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;

    const asset = res.assets[0];
    try {
      // Shrink and convert to JPEG (also handles HEIC from iPhones).
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > MAX_SIDE) {
        ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
      }
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      setPhoto(saved.uri);
    } catch {
      setError("Couldn't read that photo. Try another one.");
    }
  }

  // ---------- location ----------

  async function enableLocation() {
    setLocStatus("Finding you…");
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocation(null);
      setLocStatus("Blocked: allow location in Settings for nearby stores");
      return;
    }
    try {
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setLocStatus("On: showing nearby stores");
    } catch {
      setLocStatus("Couldn't get your location: online results only");
    }
  }

  // ---------- search ----------

  async function find() {
    if (!photo) return;
    setError("");
    setScreen("loading");
    setLoadingText("Looking at your photo…");
    const slow = setTimeout(() => setLoadingText("Checking stores and prices…"), 3500);
    try {
      const result = await snap({ photoUri: photo, location, prefer, hint });
      setSnapResult(result);
      setResults(result);
      setQuery(result.item.searchQuery);
      setScreen("results");
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (e) {
      setError((e as Error).message);
      setScreen("capture");
    } finally {
      clearTimeout(slow);
    }
  }

  async function refine() {
    if (!query.trim()) return;
    setRefining(true);
    try {
      setResults(await search({ query: query.trim(), item: snapResult?.item, location, prefer }));
    } catch (e) {
      Alert.alert("Search failed", (e as Error).message);
    } finally {
      setRefining(false);
    }
  }

  function reset() {
    setScreen("capture");
    setPhoto(null);
    setHint("");
    setSnapResult(null);
    setResults(null);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  // ---------- UI ----------

  const item = snapResult?.item;
  const confLabel = snapResult?.itemIsDemo
    ? "Demo"
    : item
      ? { high: "Confident", medium: "Fairly sure", low: "Not sure" }[item.confidence]
      : "";

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.brand}>SnapShop</Text>
            <Text style={s.tagline}>Snap it. Find it. Buy it.</Text>
          </View>

          {screen === "capture" && (
            <View style={s.card}>
              <View style={s.photoZone}>
                {photo ? (
                  <Image source={{ uri: photo }} style={s.photo} resizeMode="contain" />
                ) : (
                  <Text style={s.muted}>Take a photo of what you want to buy</Text>
                )}
              </View>

              <View style={s.row}>
                <Btn theme={t} primary label="Take photo" onPress={() => pick("camera")} style={{ flex: 1 }} />
                <Btn theme={t} label="Upload" onPress={() => pick("library")} style={{ flex: 1 }} />
              </View>

              <Text style={[s.muted, s.label]}>Anything to add? (optional)</Text>
              <TextInput
                value={hint}
                onChangeText={setHint}
                placeholder="e.g. size 10, for a 2018 Honda CR-V"
                placeholderTextColor={t.muted}
                style={s.input}
                maxLength={200}
              />

              <View style={[s.row, { marginTop: 12, alignItems: "center" }]}>
                <Btn theme={t} label={location ? "Location on" : "Use my location"} onPress={enableLocation} />
                <Text style={[s.muted, { flex: 1 }, location && { color: t.brand, fontWeight: "600" }]}>{locStatus}</Text>
              </View>

              <Text style={[s.muted, s.label]}>What matters most?</Text>
              <View style={s.row}>
                {PREFS.map((p) => (
                  <Pressable
                    key={p.value}
                    onPress={() => setPrefer(p.value)}
                    style={[s.seg, prefer === p.value && s.segOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: prefer === p.value }}
                  >
                    <Text style={s.segText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Btn theme={t} primary big label="Find where to buy" onPress={find} disabled={!photo} />
              {!!error && <Text style={s.error}>{error}</Text>}
            </View>
          )}

          {screen === "loading" && (
            <View style={[s.card, { alignItems: "center", paddingVertical: 32 }]}>
              <ActivityIndicator size="large" color={t.brand} />
              <Text style={[s.muted, { marginTop: 12 }]}>{loadingText}</Text>
            </View>
          )}

          {screen === "results" && results && item && (
            <View>
              {results.demo && (
                <Text style={s.banner}>Demo data: add API keys on the server to see real prices and stores.</Text>
              )}

              <View style={s.card}>
                <View style={[s.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.eyebrow}>WE THINK THIS IS</Text>
                    <Text style={s.itemName}>{item.name}</Text>
                  </View>
                  <Text style={[s.pill, (item.confidence === "low" || snapResult?.itemIsDemo) && s.pillLow]}>{confLabel}</Text>
                </View>
                <View style={[s.row, { flexWrap: "wrap", gap: 6 }]}>
                  {Object.entries({ ...(item.brand ? { brand: item.brand } : {}), ...item.attributes }).map(([k, v]) => (
                    <Text key={k} style={s.chip}>
                      {k}: <Text style={{ color: t.ink, fontWeight: "600" }}>{v}</Text>
                    </Text>
                  ))}
                </View>
                {!!item.notes && <Text style={s.note}>{item.notes}</Text>}

                <View style={s.refine}>
                  <Text style={s.muted}>Not quite right? Edit the search:</Text>
                  <View style={[s.row, { marginTop: 6 }]}>
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      onSubmitEditing={refine}
                      returnKeyType="search"
                      style={[s.input, { flex: 1, marginTop: 0 }]}
                      maxLength={200}
                    />
                    <Btn theme={t} label={refining ? "…" : "Search"} onPress={refine} disabled={refining} />
                  </View>
                </View>
              </View>

              <Text style={s.section}>Best options</Text>
              <View style={{ opacity: refining ? 0.5 : 1 }}>
                {results.offers.length === 0 && (
                  <Text style={s.muted}>No priced results found. Try editing the search or check the stores below.</Text>
                )}
                {results.offers.map((o, i) => (
                  <OfferCard key={o.id} offer={o} top={i === 0} theme={t} />
                ))}
              </View>

              <Text style={s.section}>More places to check</Text>
              <View style={[s.row, { flexWrap: "wrap" }]}>
                {results.moreOptions.map((o) => (
                  <Btn key={o.id} theme={t} small label={o.seller} onPress={() => o.url && Linking.openURL(o.url)} />
                ))}
              </View>

              <Btn theme={t} big label="Snap something else" onPress={reset} />
              <Text style={[s.muted, { textAlign: "center", marginTop: 16 }]}>
                Prices and stock can change. Check with the seller before you go.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Btn(props: {
  theme: Theme;
  label: string;
  onPress: () => void;
  primary?: boolean;
  big?: boolean;
  small?: boolean;
  disabled?: boolean;
  style?: object;
}) {
  const t = props.theme;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          minHeight: props.big ? 52 : props.small ? 38 : 44,
          paddingHorizontal: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: props.primary ? t.brand : t.line,
          backgroundColor: props.primary ? t.brand : t.card,
          alignItems: "center",
          justifyContent: "center",
          marginTop: props.big ? 14 : 0,
          opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        props.style,
      ]}
    >
      <Text style={{ color: props.primary ? t.brandInk : t.ink, fontWeight: "600", fontSize: props.big ? 17 : 15 }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingBottom: 40 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 },
    brand: { fontSize: 24, fontWeight: "800", color: t.ink, letterSpacing: -0.5 },
    tagline: { color: t.muted, fontSize: 13 },
    card: { backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
    photoZone: {
      minHeight: 200,
      borderRadius: 12,
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: t.line,
      backgroundColor: t.bg,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      marginBottom: 12,
    },
    photo: { width: "100%", height: 280 },
    row: { flexDirection: "row", gap: 8 },
    muted: { color: t.muted, fontSize: 14 },
    label: { marginTop: 14, marginBottom: 6 },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: t.ink,
      backgroundColor: t.bg,
      fontSize: 16,
    },
    seg: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.line,
      alignItems: "center",
    },
    segOn: { backgroundColor: t.brandSoft, borderColor: t.brand },
    segText: { color: t.ink, fontWeight: "600", fontSize: 14 },
    error: { color: t.danger, fontWeight: "600", marginTop: 10 },
    banner: {
      backgroundColor: t.warnBg,
      color: t.warnInk,
      padding: 12,
      borderRadius: 12,
      overflow: "hidden",
      fontWeight: "600",
      marginBottom: 12,
    },
    eyebrow: { color: t.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
    itemName: { color: t.ink, fontSize: 20, fontWeight: "700", marginTop: 2, marginBottom: 8 },
    pill: {
      fontSize: 12,
      fontWeight: "700",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: t.brandSoft,
      color: t.ink,
    },
    pillLow: { backgroundColor: t.warnBg, color: t.warnInk },
    chip: {
      color: t.muted,
      fontSize: 13,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    note: { color: t.ink, marginTop: 10, fontSize: 14 },
    refine: { marginTop: 14, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 },
    section: { color: t.ink, fontWeight: "700", fontSize: 16, marginTop: 8, marginBottom: 10 },
  });
