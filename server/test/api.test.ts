import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

// Run the API in demo mode with no real keys so tests never hit paid services.
process.env.DEMO_MODE = "true";
process.env.RATE_LIMIT_PER_MINUTE = "1000";
const { createApp } = await import("../src/app.js");

// Smallest valid PNG (1x1).
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

let base = "";
const server = createApp();
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

function photoForm(extra: Record<string, string> = {}, bytes: Uint8Array = PNG): FormData {
  const form = new FormData();
  form.set("photo", new Blob([bytes], { type: "image/png" }), "photo.png");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

describe("API", () => {
  it("GET /api/health", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.identify, "demo");
  });

  it("POST /api/snap returns an item, ranked offers and links", async () => {
    const res = await fetch(`${base}/api/snap`, {
      method: "POST",
      body: photoForm({ lat: "35.2271", lng: "-80.8431", prefer: "balanced" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.item.name);
    assert.ok(body.offers.length >= 5);
    assert.ok(body.offers.some((o: any) => o.kind === "in_store"));
    assert.ok(body.offers[0].badges.includes("best"));
    assert.ok(body.moreOptions.length >= 4);
    assert.equal(body.demo, true);
  });

  it("POST /api/snap without location returns online results only", async () => {
    const res = await fetch(`${base}/api/snap`, { method: "POST", body: photoForm() });
    const body = await res.json();
    assert.ok(body.offers.every((o: any) => o.kind === "online"));
  });

  it("uses the hint in demo mode", async () => {
    const res = await fetch(`${base}/api/identify`, { method: "POST", body: photoForm({ hint: "blue running shoes" }) });
    const body = await res.json();
    assert.equal(body.item.searchQuery, "blue running shoes");
  });

  it("POST /api/search", async () => {
    const res = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "10d common nails", category: "hardware", lat: 35.2, lng: -80.8, prefer: "cheapest" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.prefer, "cheapest");
    assert.equal(body.moreOptions[0].seller, "Home Depot");
  });

  it("rejects non-images", async () => {
    const res = await fetch(`${base}/api/snap`, {
      method: "POST",
      body: photoForm({}, new TextEncoder().encode("<script>alert(1)</script>")),
    });
    assert.equal(res.status, 415);
  });

  it("rejects missing photo and bad JSON", async () => {
    const form = new FormData();
    form.set("hint", "x");
    assert.equal((await fetch(`${base}/api/snap`, { method: "POST", body: form })).status, 400);
    const bad = await fetch(`${base}/api/search`, { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    assert.equal(bad.status, 400);
  });

  it("rejects oversized uploads", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG);
    const res = await fetch(`${base}/api/snap`, { method: "POST", body: photoForm({}, big) });
    assert.equal(res.status, 413);
  });

  it("serves the website and blocks path traversal", async () => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    const evil = await fetch(`${base}/..%2f..%2fserver%2fpackage.json`);
    assert.equal(evil.status, 404);
  });
});
