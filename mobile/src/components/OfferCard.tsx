import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { Theme } from "../theme";
import type { Badge, RankedOffer } from "../types";

const BADGE_LABEL: Record<Badge, string> = {
  best: "Top pick",
  cheapest: "Cheapest",
  closest: "Closest",
  fastest: "Fastest",
};

function openUrl(url?: string) {
  if (!url || !/^(https?:|tel:)/.test(url)) return;
  Linking.openURL(url).catch(() => {});
}

function etaText(hours?: number): string {
  if (hours === undefined) return "";
  if (hours < 1.5) return "get it today";
  if (hours <= 30) return "get it tomorrow";
  return `get it in ~${Math.round(hours / 24)} days`;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function OfferCard({ offer, top, theme }: { offer: RankedOffer; top: boolean; theme: Theme }) {
  const o = offer;
  const s = styles(theme);

  const where =
    o.kind === "online"
      ? `Online · ${o.delivery ?? "shipping time varies"}`
      : [
          o.kind === "in_store" ? "In store" : "Nearby store",
          o.store?.distanceMiles !== undefined ? `${o.store.distanceMiles} mi away` : null,
          o.store?.address,
        ]
          .filter(Boolean)
          .join(" · ");

  const buttons: Array<{ label: string; url?: string; primary?: boolean }> = [];
  if (o.kind === "online") buttons.push({ label: "Buy online", url: o.url, primary: true });
  if (o.kind === "in_store" && o.url) buttons.push({ label: "View item", url: o.url });
  if (o.store?.directionsUrl) buttons.push({ label: "Directions", url: o.store.directionsUrl, primary: o.kind !== "online" });
  if (o.store?.phone) buttons.push({ label: "Call", url: `tel:${o.store.phone.replace(/[^\d+]/g, "")}` });

  return (
    <View style={[s.card, top && s.top]}>
      <View style={s.row}>
        {o.imageUrl ? (
          <Image source={{ uri: o.imageUrl }} style={s.thumb} resizeMode="contain" />
        ) : (
          <View style={[s.thumb, s.thumbEmpty]}>
            <Text style={{ fontSize: 22 }}>{o.kind === "online" ? "📦" : "🏬"}</Text>
          </View>
        )}
        <View style={s.body}>
          {o.badges.length > 0 && (
            <View style={s.badges}>
              {o.badges.map((b) => (
                <Text key={b} style={[s.badge, b === "best" && s.badgeBest, b === "cheapest" && s.badgeCheap]}>
                  {BADGE_LABEL[b].toUpperCase()}
                </Text>
              ))}
            </View>
          )}
          <Text style={s.title} numberOfLines={2}>
            {o.title}
          </Text>
          <Text style={s.seller}>{o.seller}</Text>
          <Text style={s.meta}>
            {where}
            {o.store?.openNow === false && <Text style={s.bad}> · Closed now</Text>}
            {o.inStock === true && <Text style={s.ok}> · In stock</Text>}
            {o.inStock === false && <Text style={s.bad}> · Out of stock</Text>}
            {o.kind === "store_suggestion" && " · Likely carries it, call to check"}
          </Text>
        </View>
        <View style={s.priceBox}>
          {o.price ? <Text style={s.price}>{money(o.price)}</Text> : null}
          <Text style={s.eta}>{o.price ? etaText(o.etaHours) : "price varies"}</Text>
        </View>
      </View>
      {buttons.length > 0 && (
        <View style={s.actions}>
          {buttons.map((b) => (
            <Pressable
              key={b.label}
              onPress={() => openUrl(b.url)}
              style={({ pressed }) => [s.btn, b.primary && s.btnPrimary, pressed && { opacity: 0.7 }]}
              accessibilityRole="link"
            >
              <Text style={[s.btnText, b.primary && s.btnPrimaryText]}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.card,
      borderColor: t.line,
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
      marginBottom: 10,
    },
    top: { borderColor: t.brand, borderWidth: 2, padding: 11 },
    row: { flexDirection: "row", gap: 10 },
    thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: t.bg },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    body: { flex: 1, minWidth: 0 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 4 },
    badge: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.4,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
      backgroundColor: t.brandSoft,
      color: t.ink,
    },
    badgeBest: { backgroundColor: t.brand, color: t.brandInk },
    badgeCheap: { backgroundColor: t.accentSoft },
    title: { color: t.ink, fontWeight: "600", fontSize: 15 },
    seller: { color: t.ink, fontWeight: "700", marginTop: 2 },
    meta: { color: t.muted, fontSize: 13, marginTop: 2 },
    ok: { color: t.brand, fontWeight: "600" },
    bad: { color: t.danger, fontWeight: "600" },
    priceBox: { alignItems: "flex-end", maxWidth: 96 },
    price: { color: t.ink, fontWeight: "800", fontSize: 17 },
    eta: { color: t.muted, fontSize: 11, textAlign: "right" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 58 },
    btn: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.line,
      justifyContent: "center",
    },
    btnPrimary: { backgroundColor: t.brand, borderColor: t.brand },
    btnText: { color: t.ink, fontWeight: "600" },
    btnPrimaryText: { color: t.brandInk },
  });
