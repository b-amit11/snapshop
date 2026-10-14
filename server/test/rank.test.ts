import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupe, estimateEtaHours, rankOffers, relevance } from "../src/rank.js";
import type { Offer } from "../src/types.js";

const base = { source: "test", currency: "USD" };
const online = (id: string, seller: string, price: number, delivery: string, title = "Michelin Defender2 225/65R17 tire"): Offer => ({
  ...base,
  id,
  kind: "online",
  title,
  seller,
  price,
  delivery,
});
const store = (id: string, seller: string, miles: number, price?: number, inStock: boolean | null = true): Offer => ({
  ...base,
  id,
  kind: price === undefined ? "store_suggestion" : "in_store",
  title: "Michelin Defender2 225/65R17 tire",
  seller,
  price,
  inStock: price === undefined ? null : inStock,
  store: { name: seller, distanceMiles: miles },
});

const QUERY = "Michelin Defender2 225/65R17 tire";

describe("relevance", () => {
  it("scores exact matches high and unrelated listings low", () => {
    assert.equal(relevance("Michelin Defender2 All-Season 225/65R17 102H Tire", QUERY), 1);
    assert.ok(relevance("Chrome valve stem caps 4 pack", QUERY) < 0.3);
  });
});

describe("estimateEtaHours", () => {
  const wed = new Date("2026-10-14T12:00:00");
  it("parses common delivery phrases", () => {
    assert.equal(estimateEtaHours(online("a", "x", 1, "Free delivery tomorrow"), wed), 24);
    assert.equal(estimateEtaHours(online("a", "x", 1, "Same-day delivery"), wed), 5);
    assert.equal(estimateEtaHours(online("a", "x", 1, "Arrives in 2-4 days"), wed), 72);
    assert.equal(estimateEtaHours(online("a", "x", 1, "Free delivery by Fri"), wed), 48);
    assert.equal(estimateEtaHours(online("a", "x", 1, ""), wed), 96);
  });
  it("uses drive time for stores", () => {
    assert.ok(estimateEtaHours(store("s", "Walmart", 2, 10)) < 1);
  });
});

describe("dedupe", () => {
  it("keeps the cheaper duplicate from the same seller", () => {
    const out = dedupe([online("a", "Amazon", 150, ""), online("b", "Amazon", 140, "")]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.price, 140);
  });
});

describe("rankOffers", () => {
  const offers: Offer[] = [
    online("amazon", "Amazon", 152, "Free delivery tomorrow"),
    online("walmart", "Walmart", 139, "Arrives in 3 days"),
    online("ebay", "eBay", 129, "Delivery in 5-8 days"),
    online("junk", "Junk store", 4, "tomorrow", "Valve stem caps chrome"),
    store("wm-store", "Walmart Supercenter", 2.1, 145),
    store("out", "Harris Teeter", 1, 120, false),
    store("tire-shop", "Local Tire Shop", 3),
    { ...base, id: "link", kind: "search_link", title: "Search Amazon", seller: "Amazon", url: "https://amazon.com" },
  ];

  it("drops search links, irrelevant listings and price outliers", () => {
    const ids = rankOffers(offers, QUERY).map((o) => o.id);
    assert.ok(!ids.includes("link"));
    assert.ok(!ids.includes("junk"));
  });

  it("gives the cheapest badge to the lowest in-stock relevant price", () => {
    const ranked = rankOffers(offers, QUERY);
    const cheapest = ranked.find((o) => o.badges.includes("cheapest"));
    assert.equal(cheapest?.id, "ebay"); // Harris Teeter at $120 is out of stock
  });

  it("gives closest to the nearest available store", () => {
    const ranked = rankOffers(offers, QUERY);
    assert.equal(ranked.find((o) => o.badges.includes("closest"))?.id, "wm-store");
  });

  it("ranks out-of-stock items below in-stock ones", () => {
    const ranked = rankOffers(offers, QUERY);
    assert.equal(ranked.at(-1)?.id, "out");
  });

  it("changes the winner with the shopper's preference", () => {
    assert.equal(rankOffers(offers, QUERY, { prefer: "cheapest" })[0]!.id, "ebay");
    assert.equal(rankOffers(offers, QUERY, { prefer: "fastest" })[0]!.id, "wm-store");
  });
});
