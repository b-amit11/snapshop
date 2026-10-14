import type { GeoPoint } from "./types.js";

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance between two points, in miles. */
export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== "object") return false;
  const { lat, lng } = p as GeoPoint;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Parse lat/lng from loose input (form fields are strings). */
export function parsePoint(lat: unknown, lng: unknown): GeoPoint | undefined {
  if (lat === undefined || lat === null || lat === "" || lng === undefined || lng === null || lng === "") {
    return undefined;
  }
  const p = { lat: Number(lat), lng: Number(lng) };
  return isValidPoint(p) ? p : undefined;
}

export function directionsUrl(p: GeoPoint, label?: string): string {
  const dest = `${p.lat},${p.lng}`;
  const q = new URLSearchParams({ api: "1", destination: dest });
  if (label) q.set("destination", `${label} ${dest}`.trim());
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** Move a point roughly `miles` away at `bearingDeg` (for demo data). */
export function offsetPoint(p: GeoPoint, miles: number, bearingDeg: number): GeoPoint {
  const d = miles / EARTH_RADIUS_MILES;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lng1 = (p.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180 };
}
