// SnapShop web app. Plain JS, no build step.
// Talks to the API described in server/src/app.ts.

const API = (document.querySelector('meta[name="snapshop-api"]')?.content || "").replace(/\/$/, "");
const MAX_SIDE = 1600; // px; photos are shrunk before upload to stay fast and under the 5 MB limit

const $ = (id) => document.getElementById(id);
const els = {
  cameraInput: $("cameraInput"),
  galleryInput: $("galleryInput"),
  preview: $("preview"),
  photoEmpty: $("photoEmpty"),
  hint: $("hint"),
  locBtn: $("locBtn"),
  locStatus: $("locStatus"),
  findBtn: $("findBtn"),
  error: $("error"),
  capture: $("capture"),
  loading: $("loading"),
  loadingText: $("loadingText"),
  results: $("results"),
  demoBanner: $("demoBanner"),
  itemName: $("itemName"),
  itemConfidence: $("itemConfidence"),
  itemAttrs: $("itemAttrs"),
  itemNotes: $("itemNotes"),
  refineForm: $("refineForm"),
  queryInput: $("queryInput"),
  offers: $("offers"),
  noOffers: $("noOffers"),
  moreOptions: $("moreOptions"),
  providerList: $("providerList"),
  againBtn: $("againBtn"),
  offerTpl: $("offerTpl"),
};

const state = {
  photo: null, // Blob ready to upload
  location: null, // { lat, lng }
  item: null,
};

// ---------- small helpers ----------

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

function prefer() {
  return document.querySelector('input[name="prefer"]:checked')?.value || "balanced";
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function linkButton(label, href, primary = false) {
  const url = safeUrl(href);
  if (!url) return null;
  return el("a", { class: `btn btn-sm${primary ? " btn-primary" : ""}`, href: url, target: "_blank", rel: "noopener noreferrer" }, label);
}

const money = (n, cur = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(n);

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

function setView(view) {
  els.capture.hidden = view !== "capture";
  els.loading.hidden = view !== "loading";
  els.results.hidden = view !== "results";
  if (view === "results") window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- photo ----------

async function shrinkImage(file) {
  // Decode (honoring EXIF rotation), scale down, re-encode as JPEG.
  // If the browser can't decode it (e.g. HEIC on desktop Chrome), upload the original.
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

async function onPhotoChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-choosing the same file
  if (!file) return;
  showError("");
  if (!file.type.startsWith("image/") && file.type !== "") {
    showError("That file isn't a photo.");
    return;
  }
  state.photo = await shrinkImage(file);
  if (state.photo.size > 5 * 1024 * 1024) {
    showError("That photo is too large. Try a smaller one.");
    state.photo = null;
    return;
  }
  if (els.preview.src) URL.revokeObjectURL(els.preview.src);
  els.preview.src = URL.createObjectURL(state.photo);
  els.preview.hidden = false;
  els.photoEmpty.hidden = true;
  els.findBtn.disabled = false;
}

// ---------- location ----------

function requestLocation() {
  if (!("geolocation" in navigator)) {
    els.locStatus.textContent = "Location isn't available in this browser";
    return;
  }
  els.locStatus.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      els.locStatus.textContent = "On: showing nearby stores";
      els.locStatus.className = "on";
      els.locBtn.textContent = "Location on";
      store.set("snapshop.location", "on");
    },
    (err) => {
      state.location = null;
      els.locStatus.className = "muted";
      els.locStatus.textContent =
        err.code === err.PERMISSION_DENIED
          ? "Blocked: allow location in your browser settings for nearby stores"
          : "Couldn't get your location: online results only";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

// ---------- API calls ----------

async function api(path, init) {
  let res;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new Error("Can't reach the SnapShop server. Check your connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}).`);
  return body;
}

async function snap() {
  if (!state.photo) return;
  showError("");
  setView("loading");
  els.loadingText.textContent = "Looking at your photo…";
  const slow = setTimeout(() => (els.loadingText.textContent = "Checking stores and prices…"), 3500);

  const form = new FormData();
  form.set("photo", state.photo, "photo.jpg");
  form.set("prefer", prefer());
  const hint = els.hint.value.trim();
  if (hint) form.set("hint", hint);
  if (state.location) {
    form.set("lat", String(state.location.lat));
    form.set("lng", String(state.location.lng));
  }

  try {
    const result = await api("/api/snap", { method: "POST", body: form });
    state.item = result.item;
    renderItem(result.item, result.itemIsDemo);
    renderResults(result);
    setView("results");
  } catch (err) {
    setView("capture");
    showError(err.message);
  } finally {
    clearTimeout(slow);
  }
}

async function refine(e) {
  e.preventDefault();
  const query = els.queryInput.value.trim();
  if (!query) return;
  els.offers.setAttribute("aria-busy", "true");
  els.offers.style.opacity = "0.5";
  try {
    const result = await api("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        prefer: prefer(),
        category: state.item?.category,
        storeTypes: state.item?.storeTypes,
        ...(state.location || {}),
      }),
    });
    renderResults(result);
  } catch (err) {
    alert(err.message);
  } finally {
    els.offers.style.opacity = "";
    els.offers.removeAttribute("aria-busy");
  }
}

// ---------- rendering ----------

function renderItem(item, isDemo) {
  els.itemName.textContent = item.name;
  const conf = { high: "Confident", medium: "Fairly sure", low: "Not sure" }[item.confidence] || "";
  els.itemConfidence.textContent = isDemo ? "Demo" : conf;
  els.itemConfidence.className = `pill${item.confidence === "low" || isDemo ? " low" : ""}`;

  els.itemAttrs.replaceChildren();
  const attrs = { ...(item.brand ? { brand: item.brand } : {}), ...item.attributes };
  for (const [k, v] of Object.entries(attrs)) {
    const chip = el("span", { class: "chip" }, `${k}: `);
    chip.append(el("b", {}, v));
    els.itemAttrs.append(chip);
  }
  els.itemNotes.textContent = item.notes || "";
  els.itemNotes.hidden = !item.notes;
  els.queryInput.value = item.searchQuery;
}

const BADGE_LABEL = { best: "Top pick", cheapest: "Cheapest", closest: "Closest", fastest: "Fastest" };

function describeEta(hours) {
  if (hours === undefined || hours === null) return "";
  if (hours < 1.5) return "today";
  if (hours <= 30) return "tomorrow";
  return `~${Math.round(hours / 24)} days`;
}

function renderOffer(o, index) {
  const node = els.offerTpl.content.firstElementChild.cloneNode(true);
  if (index === 0) node.classList.add("top-pick");

  const thumb = node.querySelector(".thumb");
  const img = safeUrl(o.imageUrl);
  if (img) {
    thumb.src = img;
    thumb.referrerPolicy = "no-referrer";
    thumb.onerror = () => thumb.replaceWith(placeholderIcon(o));
  } else {
    thumb.replaceWith(placeholderIcon(o));
  }

  const badges = node.querySelector(".badges");
  for (const b of o.badges) badges.append(el("span", { class: `badge ${b}` }, BADGE_LABEL[b] || b));

  node.querySelector(".offer-title").textContent = o.title;
  node.querySelector(".offer-seller").textContent = o.seller;

  const meta = node.querySelector(".offer-meta");
  const parts = [];
  if (o.kind === "online") {
    parts.push(document.createTextNode(`Online · ${o.delivery || "shipping time varies"}`));
  } else {
    const where = [o.store?.distanceMiles !== undefined ? `${o.store.distanceMiles} mi away` : null, o.store?.address]
      .filter(Boolean)
      .join(" · ");
    parts.push(document.createTextNode(`${o.kind === "in_store" ? "In store" : "Nearby store"} · ${where}`));
    if (o.store?.openNow === false) parts.push(el("span", { class: "bad" }, " · Closed now"));
  }
  if (o.inStock === true) parts.push(el("span", { class: "ok" }, " · In stock"));
  if (o.inStock === false) parts.push(el("span", { class: "bad" }, " · Out of stock"));
  if (o.kind === "store_suggestion") parts.push(document.createTextNode(" · Likely carries it, call to check"));
  meta.append(...parts);

  const price = node.querySelector(".price");
  if (o.price) {
    price.textContent = money(o.price, o.currency);
    const eta = describeEta(o.etaHours);
    if (eta) price.append(el("small", {}, `get it ${eta}`));
  } else {
    price.append(el("small", {}, o.kind === "store_suggestion" ? "price varies" : ""));
  }

  const actions = node.querySelector(".actions");
  const buttons = [
    o.kind === "online" ? linkButton("Buy online", o.url, true) : null,
    o.kind === "in_store" ? linkButton("View item", o.url) : null,
    o.store?.directionsUrl ? linkButton("Directions", o.store.directionsUrl, o.kind !== "online") : null,
    o.store?.phone ? el("a", { class: "btn btn-sm", href: `tel:${o.store.phone.replace(/[^\d+]/g, "")}` }, "Call") : null,
    o.kind === "store_suggestion" && !o.store?.directionsUrl ? linkButton("Open map", o.url) : null,
  ].filter(Boolean);
  actions.append(...buttons);
  return node;
}

function placeholderIcon(o) {
  const icon = o.kind === "online" ? "📦" : "🏬";
  return el("div", { class: "thumb placeholder", "aria-hidden": "true" }, icon);
}

function renderResults(result) {
  els.demoBanner.hidden = !result.demo;

  els.offers.replaceChildren(...result.offers.map(renderOffer));
  els.noOffers.hidden = result.offers.length > 0;

  els.moreOptions.replaceChildren(
    ...result.moreOptions.map((o) => linkButton(o.seller, o.url)).filter(Boolean),
  );

  els.providerList.replaceChildren(
    ...result.providers.map((p) =>
      el(
        "li",
        { class: p.ok ? "" : "fail" },
        p.ok ? `${p.name}: ${p.count} results (${p.ms} ms)` : `${p.name}: failed (${p.error})`,
      ),
    ),
  );
}

// ---------- wire up ----------

els.cameraInput.addEventListener("change", onPhotoChosen);
els.galleryInput.addEventListener("change", onPhotoChosen);
els.locBtn.addEventListener("click", requestLocation);
els.findBtn.addEventListener("click", snap);
els.refineForm.addEventListener("submit", refine);
els.againBtn.addEventListener("click", () => {
  setView("capture");
  window.scrollTo({ top: 0 });
});

const savedPrefer = store.get("snapshop.prefer");
if (savedPrefer) {
  const radio = document.querySelector(`input[name="prefer"][value="${CSS.escape(savedPrefer)}"]`);
  if (radio) radio.checked = true;
}
document.querySelectorAll('input[name="prefer"]').forEach((r) =>
  r.addEventListener("change", () => store.set("snapshop.prefer", prefer())),
);

// If they allowed location before, quietly turn it back on.
if (store.get("snapshop.location") === "on" && navigator.permissions?.query) {
  navigator.permissions
    .query({ name: "geolocation" })
    .then((p) => p.state === "granted" && requestLocation())
    .catch(() => {});
}
