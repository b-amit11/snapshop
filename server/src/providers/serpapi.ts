import { config } from "../config.js";
import type { Offer } from "../types.js";
import { fetchJson, hash, parsePrice } from "../util.js";
import { reverseGeocodeCity } from "./places.js";
import type { Provider, ProviderContext } from "./types.js";

/**
 * Online prices from Google Shopping via SerpApi.
 * Covers Amazon, Walmart.com, Target, eBay, Home Depot and most other online sellers.
 * Docs: https://serpapi.com/google-shopping-api
 */
interface SerpShoppingResult {
  title?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  link?: string;
  product_link?: string;
  thumbnail?: string;
  delivery?: string;
  rating?: number;
  reviews?: number;
}

export const serpApiProvider: Provider = {
  name: "Google Shopping",
  enabled: () => Boolean(config.serpApiKey) && !config.forceDemo,

  async search(ctx: ProviderContext): Promise<Offer[]> {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q: ctx.query,
      gl: "us",
      hl: "en",
      num: "20",
      api_key: config.serpApiKey,
    });
    // Localizes prices/delivery estimates. Needs Google Geocoding; skipped if unavailable.
    if (ctx.location) {
      const city = await reverseGeocodeCity(ctx.location, ctx.signal).catch(() => undefined);
      if (city) params.set("location", city);
    }

    const data = await fetchJson<{ shopping_results?: SerpShoppingResult[]; error?: string }>(
      `https://serpapi.com/search.json?${params}`,
      { signal: ctx.signal },
    );
    if (data.error) throw new Error(data.error);
    return parseShoppingResults(data.shopping_results ?? []);
  },
};

export function parseShoppingResults(results: SerpShoppingResult[]): Offer[] {
  const offers: Offer[] = [];
  for (const r of results) {
    const url = r.product_link || r.link;
    if (!r.title || !url) continue;
    offers.push({
      id: `serp-${hash(url)}`,
      kind: "online",
      title: r.title,
      seller: cleanSeller(r.source ?? "Online store"),
      price: parsePrice(r.extracted_price ?? r.price),
      currency: "USD",
      url,
      imageUrl: r.thumbnail,
      delivery: r.delivery,
      inStock: null,
      rating: r.rating,
      reviews: r.reviews,
      source: "Google Shopping",
    });
  }
  return offers;
}

function cleanSeller(s: string): string {
  const trimmed = s.trim();
  const map: Record<string, string> = {
    "amazon.com": "Amazon",
    "amazon.com - seller": "Amazon (marketplace)",
    "walmart": "Walmart",
    "walmart - seller": "Walmart (marketplace)",
    "target": "Target",
    "ebay": "eBay",
    "the home depot": "Home Depot",
    "lowe's": "Lowe's",
  };
  return map[trimmed.toLowerCase()] ?? trimmed;
}
