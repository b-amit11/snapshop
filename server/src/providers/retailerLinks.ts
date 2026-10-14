import type { Offer } from "../types.js";
import type { Provider, ProviderContext } from "./types.js";

/**
 * Always-on fallback: direct search links on retailer sites, chosen by category.
 * Needs no API keys, so the app is useful even before any are configured.
 */
interface Retailer {
  name: string;
  url: (q: string) => string;
  /** Categories this retailer is relevant for; empty = always. */
  categories: RegExp | null;
}

const e = encodeURIComponent;

const RETAILERS: Retailer[] = [
  { name: "Amazon", url: (q) => `https://www.amazon.com/s?k=${e(q)}`, categories: null },
  { name: "Walmart", url: (q) => `https://www.walmart.com/search?q=${e(q)}`, categories: null },
  { name: "Target", url: (q) => `https://www.target.com/s?searchTerm=${e(q)}`, categories: null },
  {
    name: "Google Shopping",
    url: (q) => `https://www.google.com/search?tbm=shop&q=${e(q)}`,
    categories: null,
  },
  {
    name: "Home Depot",
    url: (q) => `https://www.homedepot.com/s/${e(q)}`,
    categories: /hardware|home|tool|garden|plumb|electric|paint|build|lumber|fastener/i,
  },
  {
    name: "Lowe's",
    url: (q) => `https://www.lowes.com/search?searchTerm=${e(q)}`,
    categories: /hardware|home|tool|garden|plumb|electric|paint|build|lumber|fastener|appliance/i,
  },
  {
    name: "AutoZone",
    url: (q) => `https://www.autozone.com/searchresult?searchText=${e(q)}`,
    categories: /auto|car|vehicle|tire|motor/i,
  },
  {
    name: "O'Reilly Auto Parts",
    url: (q) => `https://www.oreillyauto.com/search?q=${e(q)}`,
    categories: /auto|car|vehicle|motor/i,
  },
  {
    name: "Best Buy",
    url: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${e(q)}`,
    categories: /electronic|computer|phone|audio|camera|tv|gaming|cable|charger/i,
  },
  {
    name: "Harris Teeter",
    url: (q) => `https://www.harristeeter.com/search?query=${e(q)}`,
    categories: /grocery|food|drink|beverage|snack|household|cleaning|pharmacy|health|beauty/i,
  },
  {
    name: "Instacart",
    url: (q) => `https://www.instacart.com/store/s?k=${e(q)}`,
    categories: /grocery|food|drink|beverage|snack|household|cleaning/i,
  },
  { name: "eBay", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${e(q)}`, categories: null },
];

export function retailerLinks(query: string, category = "", storeTypes: string[] = []): Offer[] {
  const context = [category, ...storeTypes].join(" ");
  const specific = RETAILERS.filter((r) => r.categories?.test(context));
  const general = RETAILERS.filter((r) => r.categories === null);
  // Category specialists first, then the general stores.
  return [...specific, ...general].map((r) => ({
    id: `link-${r.name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    kind: "search_link" as const,
    title: `Search ${r.name}`,
    seller: r.name,
    url: r.url(query),
    source: "Retailer search",
  }));
}

export const retailerLinksProvider: Provider = {
  name: "Retailer links",
  enabled: () => true,
  async search(ctx: ProviderContext): Promise<Offer[]> {
    return retailerLinks(ctx.query, ctx.category ?? ctx.item?.category, ctx.storeTypes);
  },
};
