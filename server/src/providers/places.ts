import { config } from "../config.js";
import { directionsUrl, distanceMiles } from "../geo.js";
import type { GeoPoint, Offer } from "../types.js";
import { fetchJson } from "../util.js";
import type { Provider, ProviderContext } from "./types.js";

/**
 * Nearby stores that probably carry the item, from Google Places API (New) Text Search.
 * These have no price or stock info: the app shows them as "call ahead" options.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
interface PlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    currentOpeningHours?: { openNow?: boolean };
    googleMapsUri?: string;
    nationalPhoneNumber?: string;
  }>;
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.currentOpeningHours.openNow",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",
].join(",");

const MAX_STORES = 6;

export const placesProvider: Provider = {
  name: "Nearby stores",
  enabled: () => Boolean(config.googleMapsApiKey) && !config.forceDemo,

  async search(ctx: ProviderContext): Promise<Offer[]> {
    const origin = ctx.location;
    if (!origin) return [];

    const radiusMeters = Math.min(50_000, ctx.radiusMiles * 1609.34);
    const queries = [...new Set(ctx.storeTypes.map((s) => s.toLowerCase()))].slice(0, 3);
    if (!queries.length) queries.push("department store");

    const responses = await Promise.all(
      queries.map((textQuery) =>
        fetchJson<PlacesResponse>("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": config.googleMapsApiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: 6,
            locationBias: {
              circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: radiusMeters },
            },
          }),
          signal: ctx.signal,
        }),
      ),
    );

    const seen = new Set<string>();
    const offers: Offer[] = [];
    for (const res of responses) {
      for (const p of res.places ?? []) {
        if (seen.has(p.id) || !p.location) continue;
        seen.add(p.id);
        const where: GeoPoint = { lat: p.location.latitude, lng: p.location.longitude };
        const dist = distanceMiles(origin, where);
        if (dist > ctx.radiusMiles * 1.5) continue;
        const name = p.displayName?.text ?? "Store";
        offers.push({
          id: `place-${p.id}`,
          kind: "store_suggestion",
          title: ctx.item?.name ?? ctx.query,
          seller: name,
          url: p.googleMapsUri,
          inStock: null,
          source: "Google Places",
          store: {
            name,
            address: p.formattedAddress,
            lat: where.lat,
            lng: where.lng,
            distanceMiles: Math.round(dist * 10) / 10,
            openNow: p.currentOpeningHours?.openNow,
            phone: p.nationalPhoneNumber,
            directionsUrl: directionsUrl(where, name),
          },
        });
      }
    }
    return offers.sort((a, b) => a.store!.distanceMiles! - b.store!.distanceMiles!).slice(0, MAX_STORES);
  },
};

const cityCache = new Map<string, string | undefined>();

/** "Charlotte, North Carolina, United States" for SerpApi's location parameter. */
export async function reverseGeocodeCity(p: GeoPoint, signal?: AbortSignal): Promise<string | undefined> {
  if (!config.googleMapsApiKey) return undefined;
  const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
  if (cityCache.has(key)) return cityCache.get(key);

  const params = new URLSearchParams({
    latlng: `${p.lat},${p.lng}`,
    result_type: "locality",
    key: config.googleMapsApiKey,
  });
  const data = await fetchJson<{
    results?: Array<{ address_components: Array<{ long_name: string; types: string[] }> }>;
  }>(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal });

  const comps = data.results?.[0]?.address_components ?? [];
  const find = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
  const city = find("locality");
  const state = find("administrative_area_level_1");
  const country = find("country");
  const result = city && state ? [city, state, country].filter(Boolean).join(",") : undefined;
  if (cityCache.size > 500) cityCache.clear();
  cityCache.set(key, result);
  return result;
}
