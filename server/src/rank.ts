import type { Badge, Offer, Preference, RankedOffer } from "./types.js";
import { round } from "./util.js";

/**
 * Ranking: every buyable offer gets a 0-1 score from four signals.
 *   price     - cheapest relevant price = 1, others scaled down proportionally
 *   speed     - how soon you could have it (drive to a store vs. shipping time)
 *   certainty - confirmed in stock > unknown > "store probably has it" > out of stock
 *   relevance - how well the listing title matches the search (filters accessories/junk)
 * The shopper's preference changes the weights.
 */
const WEIGHTS: Record<Preference, { price: number; speed: number; certainty: number }> = {
  balanced: { price: 0.45, speed: 0.35, certainty: 0.2 },
  cheapest: { price: 0.7, speed: 0.12, certainty: 0.18 },
  fastest: { price: 0.15, speed: 0.65, certainty: 0.2 },
};

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "of", "with", "in", "to", "pack", "new"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^[./]+|[./]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Share of the query's words that appear in the title (0-1). */
export function relevance(title: string, query: string): number {
  const q = [...new Set(tokens(query))];
  if (!q.length) return 1;
  const t = tokens(title);
  const tset = new Set(t);
  const joined = t.join(" ");
  const hits = q.filter((w) => tset.has(w) || (w.length >= 4 && joined.includes(w))).length;
  return hits / q.length;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Rough hours until the item is in hand, from delivery text or store distance. */
export function estimateEtaHours(offer: Offer, now = new Date()): number {
  if (offer.kind === "in_store" || offer.kind === "store_suggestion") {
    const miles = offer.store?.distanceMiles ?? 5;
    // Drive (~3 min/mile city driving) + ~20 min in the store.
    return (miles * 3 + 20) / 60;
  }
  const d = (offer.delivery ?? "").toLowerCase();
  if (!d) return 96;
  if (/same.?day|today|\b[1-4] ?(hour|hr)/.test(d)) return 5;
  if (/tomorrow|next.?day|overnight/.test(d)) return 24;
  const range = d.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:business\s*)?days?/);
  if (range) return ((Number(range[1]) + Number(range[2])) / 2) * 24 * (/business/.test(d) ? 1.3 : 1);
  const single = d.match(/(\d+)\s*(?:business\s*)?days?/);
  if (single) return Number(single[1]) * 24 * (/business/.test(d) ? 1.3 : 1);
  const weekday = d.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (weekday) {
    const target = DAYS.indexOf(weekday[1]!);
    const diff = (target - now.getDay() + 7) % 7 || 7;
    return diff * 24;
  }
  return 96;
}

function certainty(o: Offer): number {
  if (o.inStock === false) return 0.05;
  if (o.kind === "store_suggestion") return 0.4;
  if (o.inStock === true) return 1;
  return o.kind === "online" ? 0.75 : 0.6;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Remove duplicates (same seller + same title) keeping the cheaper one. */
export function dedupe(offers: Offer[]): Offer[] {
  const best = new Map<string, Offer>();
  for (const o of offers) {
    const key = `${o.seller.toLowerCase()}|${o.store?.address ?? ""}|${tokens(o.title).slice(0, 8).join(" ")}`;
    const prev = best.get(key);
    if (!prev || (o.price ?? Infinity) < (prev.price ?? Infinity)) best.set(key, o);
  }
  return [...best.values()];
}

export interface RankOptions {
  prefer?: Preference;
  now?: Date;
  limit?: number;
}

export function rankOffers(input: Offer[], query: string, opts: RankOptions = {}): RankedOffer[] {
  const prefer = opts.prefer ?? "balanced";
  const w = WEIGHTS[prefer];
  const offers = dedupe(input.filter((o) => o.kind !== "search_link"));

  // Drop listings that clearly aren't the item (low title match or suspiciously cheap,
  // e.g. a $4 valve cap when searching for a $160 tire). Store suggestions are kept:
  // their "title" is our own label, not a listing.
  const withRel = offers.map((o) => ({ o, rel: o.kind === "store_suggestion" ? 1 : relevance(o.title, query) }));
  const relevant = withRel.filter(({ rel }) => rel >= 0.3);
  const pool = relevant.length >= 3 ? relevant : withRel; // don't over-filter tiny result sets
  const med = median(pool.map(({ o }) => o.price).filter((p): p is number => p !== undefined));
  const sane = pool.filter(({ o }) => o.price === undefined || !med || o.price >= med * 0.25);

  const prices = sane
    .filter(({ o }) => o.price !== undefined && o.inStock !== false)
    .map(({ o }) => o.price!);
  const minPrice = prices.length ? Math.min(...prices) : undefined;

  const ranked: RankedOffer[] = sane.map(({ o, rel }) => {
    const etaHours = estimateEtaHours(o, opts.now);
    // Cubed so a 10% higher price costs noticeably more than 10% of the score.
    const priceScore = o.price !== undefined && minPrice ? Math.min(1, minPrice / o.price) ** 3 : 0.3;
    const speedScore = 1 / (1 + etaHours / 24);
    const raw = w.price * priceScore + w.speed * speedScore + w.certainty * certainty(o);
    // Out-of-stock items stay visible (useful to know) but sink to the bottom.
    const score = raw * (0.6 + 0.4 * rel) * (o.inStock === false ? 0.3 : 1);
    return { ...o, score: round(score, 4), etaHours: round(etaHours, 1), badges: [] };
  });

  ranked.sort((a, b) => b.score - a.score);
  assignBadges(ranked);
  return ranked.slice(0, opts.limit ?? 25);
}

function assignBadges(ranked: RankedOffer[]): void {
  const available = ranked.filter((o) => o.inStock !== false);
  const pick = (list: RankedOffer[], key: (o: RankedOffer) => number | undefined): RankedOffer | undefined => {
    let best: RankedOffer | undefined;
    let bestVal = Infinity;
    for (const o of list) {
      const v = key(o);
      if (v !== undefined && v < bestVal) {
        best = o;
        bestVal = v;
      }
    }
    return best;
  };
  const add = (o: RankedOffer | undefined, b: Badge) => o && !o.badges.includes(b) && o.badges.push(b);

  add(available[0], "best");
  add(
    pick(available, (o) => o.price),
    "cheapest",
  );
  add(
    pick(available, (o) => o.store?.distanceMiles),
    "closest",
  );
  // "Fastest" only for things we're fairly sure you can actually get.
  add(
    pick(
      available.filter((o) => o.kind !== "store_suggestion"),
      (o) => o.etaHours,
    ),
    "fastest",
  );
}
