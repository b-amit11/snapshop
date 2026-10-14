import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distanceMiles, offsetPoint, parsePoint } from "../src/geo.js";
import { normalizeIdentification, sniffImageType } from "../src/identify.js";
import { toOffer } from "../src/providers/kroger.js";
import { retailerLinks } from "../src/providers/retailerLinks.js";
import { parseShoppingResults } from "../src/providers/serpapi.js";

const charlotte = { lat: 35.2271, lng: -80.8431 };

describe("geo", () => {
  it("measures distance in miles", () => {
    const raleigh = { lat: 35.7796, lng: -78.6382 };
    const d = distanceMiles(charlotte, raleigh);
    assert.ok(d > 125 && d < 135, `got ${d}`);
  });
  it("offsetPoint round-trips", () => {
    const p = offsetPoint(charlotte, 3, 90);
    assert.ok(Math.abs(distanceMiles(charlotte, p) - 3) < 0.01);
  });
  it("parsePoint rejects junk", () => {
    assert.equal(parsePoint("abc", "1"), undefined);
    assert.equal(parsePoint("91", "0"), undefined);
    assert.equal(parsePoint(undefined, undefined), undefined);
    assert.deepEqual(parsePoint("35.2", "-80.8"), { lat: 35.2, lng: -80.8 });
  });
});

describe("serpapi parsing", () => {
  it("maps shopping results and cleans seller names", () => {
    const offers = parseShoppingResults([
      { title: "Tire", source: "Amazon.com", extracted_price: 151.99, product_link: "https://g.co/1", delivery: "Free delivery tomorrow" },
      { title: "Tire 2", source: "Walmart", price: "$1,139.00", link: "https://g.co/2" },
      { title: "no link" },
    ]);
    assert.equal(offers.length, 2);
    assert.equal(offers[0]!.seller, "Amazon");
    assert.equal(offers[0]!.price, 151.99);
    assert.equal(offers[1]!.price, 1139);
  });
});

describe("kroger parsing", () => {
  it("maps a product at a Harris Teeter location", () => {
    const offer = toOffer(
      {
        productId: "0001",
        brand: "Kroger",
        description: "Kroger Flat Shoelaces 54in",
        items: [{ price: { regular: 4.99, promo: 3.99 }, inventory: { stockLevel: "LOW" } }],
      },
      {
        locationId: "09700",
        chain: "HARRISTEETER",
        name: "Harris Teeter - South Blvd",
        geolocation: { latitude: 35.2, longitude: -80.86 },
      },
      charlotte,
    );
    assert.ok(offer);
    assert.equal(offer.price, 3.99);
    assert.equal(offer.inStock, true);
    assert.equal(offer.kind, "in_store");
    assert.match(offer.url!, /^https:\/\/www\.harristeeter\.com\/p\//);
    assert.ok(offer.store!.distanceMiles! < 3);
  });
});

describe("retailer links", () => {
  it("puts category specialists first", () => {
    const links = retailerLinks("10d nails", "hardware", ["hardware store"]);
    assert.equal(links[0]!.seller, "Home Depot");
    assert.ok(links.some((l) => l.seller === "Amazon"));
    assert.ok(links.every((l) => l.url!.startsWith("https://")));
  });
  it("adds auto stores for tires", () => {
    const links = retailerLinks("225/65R17", "auto parts", ["tire shop"]);
    assert.equal(links[0]!.seller, "AutoZone");
  });
});

describe("identification", () => {
  it("normalizes messy model output", () => {
    const item = normalizeIdentification({
      name: "  Shoelaces ",
      attributes: { length: 54, color: "white", nested: { x: 1 } },
      storeTypes: ["shoe store", 5, "", "a", "b"],
      confidence: "very",
    });
    assert.equal(item.name, "Shoelaces");
    assert.equal(item.searchQuery, "Shoelaces");
    assert.deepEqual(item.attributes, { length: "54", color: "white" });
    assert.deepEqual(item.storeTypes, ["shoe store", "a", "b"]);
    assert.equal(item.confidence, "low");
  });
  it("sniffs image types from magic bytes", () => {
    assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
    assert.equal(sniffImageType(new TextEncoder().encode("not an image at all")), undefined);
  });
});
