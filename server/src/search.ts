import { config } from "./config.js";
import { demoProvider } from "./providers/demo.js";
import { krogerProvider } from "./providers/kroger.js";
import { placesProvider } from "./providers/places.js";
import { retailerLinksProvider } from "./providers/retailerLinks.js";
import { serpApiProvider } from "./providers/serpapi.js";
import type { Provider, ProviderContext } from "./providers/types.js";
import { rankOffers } from "./rank.js";
import type { GeoPoint, ItemIdentification, Offer, Preference, ProviderStatus, SearchResult } from "./types.js";
import { withTimeout } from "./util.js";

export const ALL_PROVIDERS: Provider[] = [
  serpApiProvider,
  krogerProvider,
  placesProvider,
  demoProvider,
  retailerLinksProvider,
];

export interface SearchInput {
  query: string;
  item?: ItemIdentification;
  location?: GeoPoint;
  prefer?: Preference;
  storeTypes?: string[];
  category?: string;
  radiusMiles?: number;
  signal?: AbortSignal;
}

/** Ask every enabled provider in parallel, then merge and rank the results. */
export async function searchEverywhere(input: SearchInput, providers = ALL_PROVIDERS): Promise<SearchResult> {
  const query = input.query.trim().slice(0, 200);
  const prefer = input.prefer ?? "balanced";
  const ctxBase: Omit<ProviderContext, "signal"> = {
    query,
    item: input.item,
    location: input.location,
    storeTypes: input.storeTypes?.length ? input.storeTypes : (input.item?.storeTypes ?? []),
    category: input.category ?? input.item?.category,
    radiusMiles: input.radiusMiles ?? config.searchRadiusMiles,
  };

  const active = providers.filter((p) => p.enabled());
  const settled = await Promise.all(
    active.map(async (p): Promise<{ status: ProviderStatus; offers: Offer[] }> => {
      const started = Date.now();
      try {
        const offers = await p.search({ ...ctxBase, signal: withTimeout(input.signal, config.providerTimeoutMs) });
        return { status: { name: p.name, ok: true, count: offers.length, ms: Date.now() - started }, offers };
      } catch (err) {
        const e = err as Error;
        const msg = e.name === "TimeoutError" ? "timed out" : e.message;
        console.warn(`[search] ${p.name} failed: ${msg}`);
        return {
          status: { name: p.name, ok: false, count: 0, error: msg.slice(0, 200), ms: Date.now() - started },
          offers: [],
        };
      }
    }),
  );

  const all = settled.flatMap((s) => s.offers);
  return {
    query,
    prefer,
    location: input.location,
    offers: rankOffers(all, query, { prefer }),
    moreOptions: all.filter((o) => o.kind === "search_link"),
    providers: settled.map((s) => s.status),
    demo: all.some((o) => o.demo),
  };
}

export function providerSummary() {
  return {
    identify: config.anthropicApiKey && !config.forceDemo ? "claude" : "demo",
    providers: ALL_PROVIDERS.map((p) => ({ name: p.name, enabled: p.enabled() })),
  };
}
