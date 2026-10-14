import type { GeoPoint, ItemIdentification, Preference, SearchResult, SnapResult } from "./types";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error(`Can't reach the SnapShop server at ${API_URL}. Check EXPO_PUBLIC_API_URL and your Wi-Fi.`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Something went wrong (${res.status}).`);
  return body as T;
}

export function snap(opts: {
  photoUri: string;
  location?: GeoPoint | null;
  prefer: Preference;
  hint?: string;
}): Promise<SnapResult> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for files.
  form.append("photo", { uri: opts.photoUri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
  form.append("prefer", opts.prefer);
  if (opts.hint?.trim()) form.append("hint", opts.hint.trim());
  if (opts.location) {
    form.append("lat", String(opts.location.lat));
    form.append("lng", String(opts.location.lng));
  }
  return call<SnapResult>("/api/snap", { method: "POST", body: form });
}

export function search(opts: {
  query: string;
  item?: ItemIdentification | null;
  location?: GeoPoint | null;
  prefer: Preference;
}): Promise<SearchResult> {
  return call<SearchResult>("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: opts.query,
      prefer: opts.prefer,
      category: opts.item?.category,
      storeTypes: opts.item?.storeTypes,
      ...(opts.location ?? {}),
    }),
  });
}
