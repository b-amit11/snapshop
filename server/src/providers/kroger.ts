import { config } from "../config.js";
import { directionsUrl, distanceMiles } from "../geo.js";
import type { GeoPoint, Offer } from "../types.js";
import { fetchJson, slugify } from "../util.js";
import type { Provider, ProviderContext } from "./types.js";

/**
 * Store prices and stock from the Kroger public API. Kroger owns Harris Teeter, Ralphs,
 * Fred Meyer, King Soopers, Fry's, Smith's, QFC, Dillons, Mariano's and more, so one key
 * covers all of them.
 * Docs: https://developer.kroger.com/documentation/public/
 */
const API = "https://api.kroger.com/v1";
const STORES_TO_CHECK = 3;
const PRODUCTS_PER_STORE = 4;

interface KrogerLocation {
  locationId: string;
  chain?: string;
  name?: string;
  address?: { addressLine1?: string; city?: string; state?: string; zipCode?: string };
  geolocation?: { latitude: number; longitude: number };
  phone?: string;
}

interface KrogerProduct {
  productId: string;
  description?: string;
  brand?: string;
  images?: Array<{ perspective?: string; featured?: boolean; sizes?: Array<{ size?: string; url?: string }> }>;
  items?: Array<{
    size?: string;
    price?: { regular?: number; promo?: number };
    inventory?: { stockLevel?: string };
    fulfillment?: { inStore?: boolean; curbside?: boolean; delivery?: boolean };
  }>;
}

let token: { value: string; expiresAt: number } | undefined;

async function getToken(signal: AbortSignal): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${config.krogerClientId}:${config.krogerClientSecret}`).toString("base64");
  const data = await fetchJson<{ access_token: string; expires_in: number }>(`${API}/connect/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
    signal,
  });
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export const krogerProvider: Provider = {
  name: "Kroger / Harris Teeter",
  enabled: () => Boolean(config.krogerClientId && config.krogerClientSecret) && !config.forceDemo,

  async search(ctx: ProviderContext): Promise<Offer[]> {
    const origin = ctx.location;
    if (!origin) return [];
    const auth = { authorization: `Bearer ${await getToken(ctx.signal)}` };

    const locParams = new URLSearchParams({
      "filter.latLong.near": `${origin.lat},${origin.lng}`,
      "filter.radiusInMiles": String(Math.min(100, Math.max(1, Math.round(ctx.radiusMiles)))),
      "filter.limit": String(STORES_TO_CHECK),
    });
    const locs = await fetchJson<{ data?: KrogerLocation[] }>(`${API}/locations?${locParams}`, {
      headers: auth,
      signal: ctx.signal,
    });

    const perStore = await Promise.all(
      (locs.data ?? []).map(async (loc) => {
        const params = new URLSearchParams({
          "filter.term": ctx.query.slice(0, 100),
          "filter.locationId": loc.locationId,
          "filter.limit": String(PRODUCTS_PER_STORE),
        });
        const res = await fetchJson<{ data?: KrogerProduct[] }>(`${API}/products?${params}`, {
          headers: auth,
          signal: ctx.signal,
        });
        return (res.data ?? []).map((p) => toOffer(p, loc, origin)).filter((o): o is Offer => o !== undefined);
      }),
    );
    return perStore.flat();
  },
};

export function toOffer(p: KrogerProduct, loc: KrogerLocation, origin: GeoPoint): Offer | undefined {
  const item = p.items?.[0];
  const price = item?.price?.promo || item?.price?.regular;
  if (!p.description) return undefined;

  const where = loc.geolocation ? { lat: loc.geolocation.latitude, lng: loc.geolocation.longitude } : undefined;
  const storeName = loc.name ?? chainName(loc.chain);
  const stock = item?.inventory?.stockLevel;
  const inStock =
    stock === "TEMPORARILY_OUT_OF_STOCK" ? false : stock === "HIGH" || stock === "LOW" ? true : null;
  const image = p.images?.find((i) => i.featured) ?? p.images?.[0];
  const thumb = image?.sizes?.find((s) => s.size === "medium") ?? image?.sizes?.[0];
  const addr = loc.address;

  return {
    id: `kroger-${loc.locationId}-${p.productId}`,
    kind: "in_store",
    title: [p.brand, p.description].filter(Boolean).join(" ").replace(/^(.+?) \1/, "$1"),
    seller: storeName,
    price: price && price > 0 ? price : undefined,
    currency: "USD",
    url: `https://www.${chainDomain(loc.chain)}/p/${slugify(p.description) || "item"}/${p.productId}`,
    imageUrl: thumb?.url,
    inStock,
    delivery: item?.fulfillment?.curbside ? "Pickup available" : undefined,
    source: "Kroger API",
    store: {
      name: storeName,
      address: addr ? [addr.addressLine1, addr.city, addr.state].filter(Boolean).join(", ") : undefined,
      lat: where?.lat,
      lng: where?.lng,
      distanceMiles: where ? Math.round(distanceMiles(origin, where) * 10) / 10 : undefined,
      phone: loc.phone,
      directionsUrl: where ? directionsUrl(where, storeName) : undefined,
    },
  };
}

const CHAINS: Array<[RegExp, string, string]> = [
  [/HARRIS/, "Harris Teeter", "harristeeter.com"],
  [/RALPHS/, "Ralphs", "ralphs.com"],
  [/FRED/, "Fred Meyer", "fredmeyer.com"],
  [/KING/, "King Soopers", "kingsoopers.com"],
  [/FRY/, "Fry's", "frysfood.com"],
  [/SMITH/, "Smith's", "smithsfoodanddrug.com"],
  [/QFC/, "QFC", "qfc.com"],
  [/DILLON/, "Dillons", "dillons.com"],
  [/MARIANO/, "Mariano's", "marianos.com"],
  [/PICK/, "Pick 'n Save", "picknsave.com"],
];

function chainName(chain?: string): string {
  const c = (chain ?? "").toUpperCase();
  return CHAINS.find(([re]) => re.test(c))?.[1] ?? "Kroger";
}

function chainDomain(chain?: string): string {
  const c = (chain ?? "").toUpperCase();
  return CHAINS.find(([re]) => re.test(c))?.[2] ?? "kroger.com";
}
