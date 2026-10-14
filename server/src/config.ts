import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// server/src or server/dist -> server -> repo root
const serverDir = resolve(here, "..");
const repoRoot = resolve(serverDir, "..");

// Load .env from server/ first, then the repo root. Existing env vars win.
for (const file of [resolve(serverDir, ".env"), resolve(repoRoot, ".env")]) {
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      console.warn(`Could not read ${file}:`, err);
    }
  }
}

const env = (name: string, fallback = ""): string => (process.env[name] ?? fallback).trim();
const num = (name: string, fallback: number): number => {
  const n = Number(env(name));
  return Number.isFinite(n) && env(name) !== "" ? n : fallback;
};

export const config = {
  port: num("PORT", 8787),
  host: env("HOST", "0.0.0.0"),

  /** Claude (photo identification). https://console.anthropic.com */
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  claudeModel: env("CLAUDE_MODEL", "claude-sonnet-5-5"),

  /** SerpApi Google Shopping (Amazon, Walmart, Target... prices). https://serpapi.com */
  serpApiKey: env("SERPAPI_KEY"),

  /** Kroger public API (Kroger, Harris Teeter, Ralphs... store prices + stock). https://developer.kroger.com */
  krogerClientId: env("KROGER_CLIENT_ID"),
  krogerClientSecret: env("KROGER_CLIENT_SECRET"),

  /** Google Maps Platform: Places API (New) + Geocoding API. */
  googleMapsApiKey: env("GOOGLE_MAPS_API_KEY"),

  searchRadiusMiles: num("SEARCH_RADIUS_MILES", 10),
  providerTimeoutMs: num("PROVIDER_TIMEOUT_MS", 9000),
  /** Max photo upload size in bytes (Claude accepts images up to 5 MB). */
  maxUploadBytes: num("MAX_UPLOAD_BYTES", 5 * 1024 * 1024),
  /** Requests per minute per IP for /api routes. */
  rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 30),
  /** Comma-separated allowed origins, or * for any. */
  corsOrigins: env("CORS_ORIGINS", "*"),
  /** Force demo data even when keys are set (handy for UI work). */
  forceDemo: env("DEMO_MODE") === "true",

  /** Folder of the website, served at "/". Set to "" to disable. */
  webDir: env("WEB_DIR", resolve(repoRoot, "web")),
};

export type Config = typeof config;
