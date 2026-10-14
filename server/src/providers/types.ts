import type { GeoPoint, ItemIdentification, Offer } from "../types.js";

export interface ProviderContext {
  query: string;
  /** Present when the search came from a photo. */
  item?: ItemIdentification;
  /** Store types to look for nearby, e.g. ["tire shop"]. */
  storeTypes: string[];
  category?: string;
  location?: GeoPoint;
  radiusMiles: number;
  signal: AbortSignal;
}

export interface Provider {
  name: string;
  /** True when this provider has what it needs (API keys) to run. */
  enabled(): boolean;
  search(ctx: ProviderContext): Promise<Offer[]>;
}
