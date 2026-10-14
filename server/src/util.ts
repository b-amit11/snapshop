/** Small helpers shared by providers. */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public expose = true,
  ) {
    super(message);
  }
}

/** fetch() that returns parsed JSON and throws a readable error on non-2xx. */
export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      detail = body?.error?.message ?? body?.error ?? body?.message ?? detail;
      if (typeof detail !== "string") detail = JSON.stringify(detail).slice(0, 300);
    } catch {
      /* not JSON */
    }
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${detail}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${new URL(url).host}`);
  }
}

/** Stable 32-bit hash (FNV-1a) for deterministic ids and demo data. */
export function hash(input: string | Uint8Array): number {
  let h = 0x811c9dc5;
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // Sample long inputs (images) so hashing stays cheap.
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Parse "$1,299.99" / "1299.99" / 1299.99 into a number. */
export function parsePrice(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Combine an outer abort signal with a timeout. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}
