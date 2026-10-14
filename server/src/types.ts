// Shared data shapes for the SnapShop API.
// The web app (web/app.js) and phone app (mobile/src/types.ts) mirror these.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type Confidence = "high" | "medium" | "low";

/** What the vision model thinks is in the photo. */
export interface ItemIdentification {
  /** Short shopper-friendly name, e.g. "Michelin Defender2 all-season tire 225/65R17". */
  name: string;
  brand?: string;
  /** Broad category, e.g. "auto parts", "hardware", "footwear", "grocery". */
  category: string;
  /** Specs read off the item: size, color, model number, quantity... */
  attributes: Record<string, string>;
  /** The query a shopper would type to find exactly this item. */
  searchQuery: string;
  /** 1-3 kinds of local stores likely to carry it, e.g. ["tire shop", "auto parts store"]. */
  storeTypes: string[];
  confidence: Confidence;
  /** Anything the shopper should double-check (e.g. "measure lace length"). */
  notes?: string;
}

export type OfferKind =
  | "online" // a priced listing you can buy online
  | "in_store" // a priced product at a specific nearby store (store inventory API)
  | "store_suggestion" // a nearby store that probably carries it (call ahead)
  | "search_link"; // a link to search a retailer's site yourself

export interface StoreInfo {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  distanceMiles?: number;
  openNow?: boolean;
  phone?: string;
  directionsUrl?: string;
}

export interface Offer {
  id: string;
  kind: OfferKind;
  title: string;
  /** Who sells it: "Amazon", "Walmart", "Harris Teeter - Main St"... */
  seller: string;
  price?: number;
  currency?: string;
  url?: string;
  imageUrl?: string;
  store?: StoreInfo;
  /** Delivery text as given by the source, e.g. "Free delivery by Fri". */
  delivery?: string;
  /** true = confirmed in stock, false = confirmed out, null/undefined = unknown. */
  inStock?: boolean | null;
  rating?: number;
  reviews?: number;
  /** Which provider produced this offer. */
  source: string;
  /** True when produced by the demo provider (no real API keys configured). */
  demo?: boolean;
}

export type Badge = "best" | "cheapest" | "closest" | "fastest";

export interface RankedOffer extends Offer {
  score: number;
  /** Rough hours until the shopper could have it in hand. */
  etaHours?: number;
  badges: Badge[];
}

export type Preference = "balanced" | "cheapest" | "fastest";

export interface ProviderStatus {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
  ms: number;
}

export interface SearchResult {
  query: string;
  prefer: Preference;
  location?: GeoPoint;
  /** Ranked buyable options (online listings, in-store items, likely stores). */
  offers: RankedOffer[];
  /** Retailer search links for the shopper to check themselves. */
  moreOptions: Offer[];
  providers: ProviderStatus[];
  /** True when any results are demo data. */
  demo: boolean;
}

export interface SnapResult extends SearchResult {
  item: ItemIdentification;
  itemIsDemo: boolean;
}
