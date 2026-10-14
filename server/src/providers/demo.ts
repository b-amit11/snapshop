import { config } from "../config.js";
import { directionsUrl, offsetPoint } from "../geo.js";
import type { Offer } from "../types.js";
import { hash, round } from "../util.js";
import type { Provider, ProviderContext } from "./types.js";

/**
 * Demo data so the whole app works with zero API keys.
 * Turns itself off as soon as any real price/store provider is configured.
 * Every offer is flagged `demo: true` and the apps show a "Demo data" banner.
 */
export const demoProvider: Provider = {
  name: "Demo data",
  enabled: () =>
    config.forceDemo ||
    !(config.serpApiKey || (config.krogerClientId && config.krogerClientSecret) || config.googleMapsApiKey),

  async search(ctx: ProviderContext): Promise<Offer[]> {
    const seed = hash(ctx.query);
    const jitter = (i: number, spread: number) => (((seed >>> (i * 3)) % 100) / 100 - 0.5) * spread;
    const base = basePrice(`${ctx.category ?? ""} ${ctx.item?.category ?? ""} ${ctx.query}`);
    const title = ctx.item?.name ?? ctx.query;
    const q = encodeURIComponent(ctx.query);

    const online: Offer[] = [
      {
        seller: "Amazon",
        price: base * (0.92 + jitter(1, 0.1)),
        delivery: "Free delivery tomorrow",
        url: `https://www.amazon.com/s?k=${q}`,
        rating: 4.6,
        reviews: 1200 + (seed % 5000),
      },
      {
        seller: "Walmart",
        price: base * (0.89 + jitter(2, 0.1)),
        delivery: "Free shipping, arrives in 3 days",
        url: `https://www.walmart.com/search?q=${q}`,
        rating: 4.4,
        reviews: 300 + (seed % 900),
      },
      {
        seller: "Target",
        price: base * (1.02 + jitter(3, 0.1)),
        delivery: "Delivery in 2-4 days",
        url: `https://www.target.com/s?searchTerm=${q}`,
      },
      {
        seller: "eBay",
        price: base * (0.78 + jitter(4, 0.1)),
        delivery: "Delivery in 5-8 days",
        url: `https://www.ebay.com/sch/i.html?_nkw=${q}`,
      },
    ].map((o, i) => ({
      ...o,
      id: `demo-online-${i}`,
      kind: "online" as const,
      title,
      price: round(o.price),
      currency: "USD",
      inStock: null,
      source: "Demo data",
      demo: true,
    }));

    if (!ctx.location) return online;

    const stores: Array<{ name: string; miles: number; bearing: number; price?: number; stock?: boolean | null }> = [
      { name: "Walmart Supercenter", miles: 2.1 + jitter(5, 1), bearing: 40, price: base * 0.95, stock: true },
      { name: "Harris Teeter", miles: 1.2 + jitter(6, 0.6), bearing: 200, price: base * 1.12, stock: true },
      { name: storeTypeName(ctx.storeTypes[0]), miles: 3.4 + jitter(7, 1.5), bearing: 120 },
      { name: storeTypeName(ctx.storeTypes[1] ?? "hardware store"), miles: 5.8 + jitter(8, 2), bearing: 310 },
    ];

    const local: Offer[] = stores.map((s, i) => {
      const where = offsetPoint(ctx.location!, s.miles, s.bearing);
      const priced = s.price !== undefined;
      return {
        id: `demo-store-${i}`,
        kind: priced ? ("in_store" as const) : ("store_suggestion" as const),
        title,
        seller: s.name,
        price: priced ? round(s.price!) : undefined,
        currency: "USD",
        inStock: priced ? s.stock : null,
        delivery: priced ? "Pickup today" : undefined,
        url: `https://www.google.com/maps/search/${encodeURIComponent(s.name)}/@${where.lat},${where.lng},14z`,
        source: "Demo data",
        demo: true,
        store: {
          name: s.name,
          address: "Demo address",
          lat: where.lat,
          lng: where.lng,
          distanceMiles: round(s.miles, 1),
          openNow: true,
          directionsUrl: directionsUrl(where, s.name),
        },
      };
    });

    return [...online, ...local];
  },
};

function basePrice(text: string): number {
  const t = text.toLowerCase();
  if (/tire/.test(t)) return 165;
  if (/auto|car part|brake|battery/.test(t)) return 60;
  if (/shoe ?lace|lace/.test(t)) return 6.5;
  if (/shoe|sneaker|boot/.test(t)) return 75;
  if (/nail|screw|bolt|fastener/.test(t)) return 8;
  if (/electronic|charger|cable/.test(t)) return 18;
  if (/grocery|food/.test(t)) return 5;
  return 25;
}

function storeTypeName(storeType = "department store"): string {
  const words = storeType.replace(/\b\w/g, (c) => c.toUpperCase());
  return `Local ${words}`;
}
