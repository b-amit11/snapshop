import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { config } from "./config.js";
import { parsePoint } from "./geo.js";
import { identifyItem, sniffImageType, type PhotoInput } from "./identify.js";
import { providerSummary, searchEverywhere } from "./search.js";
import type { Preference, SnapResult } from "./types.js";
import { HttpError } from "./util.js";

/**
 * HTTP API (no framework, Node built-ins only).
 *
 *   GET  /api/health    which providers are configured
 *   POST /api/identify  multipart: photo, hint?               -> { item, demo }
 *   POST /api/search    json: { query, lat?, lng?, prefer?, storeTypes?, category? } -> SearchResult
 *   POST /api/snap      multipart: photo, lat?, lng?, prefer?, hint? -> SnapResult (identify + search)
 *   GET  /*             the website in ../web
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const routes: Record<string, Handler> = {
  "GET /api/health": async (_req, res) => {
    sendJson(res, 200, { ok: true, ...providerSummary() });
  },

  "POST /api/identify": async (req, res) => {
    const form = await readForm(req);
    const photo = await readPhoto(form);
    const result = await identifyItem(photo, formString(form, "hint"));
    sendJson(res, 200, result);
  },

  "POST /api/search": async (req, res) => {
    const body = await readJson(req);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) throw new HttpError(400, "Missing 'query'.");
    const result = await searchEverywhere({
      query,
      location: parsePoint(body.lat, body.lng),
      prefer: parsePrefer(body.prefer),
      storeTypes: Array.isArray(body.storeTypes)
        ? body.storeTypes.filter((s: unknown): s is string => typeof s === "string").slice(0, 3)
        : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
    });
    sendJson(res, 200, result);
  },

  "POST /api/snap": async (req, res) => {
    const form = await readForm(req);
    const photo = await readPhoto(form);
    const { item, demo } = await identifyItem(photo, formString(form, "hint"));
    const search = await searchEverywhere({
      query: item.searchQuery,
      item,
      location: parsePoint(formString(form, "lat"), formString(form, "lng")),
      prefer: parsePrefer(formString(form, "prefer")),
    });
    const result: SnapResult = { ...search, item, itemIsDemo: demo, demo: search.demo || demo };
    sendJson(res, 200, result);
  },
};

export function createApp(): Server {
  return createServer(async (req, res) => {
    const started = Date.now();
    try {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path.startsWith("/api/")) {
        rateLimit(req);
        const handler = routes[`${req.method} ${path}`];
        if (!handler) throw new HttpError(404, "Not found.");
        await handler(req, res);
      } else if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(path, req, res);
      } else {
        throw new HttpError(405, "Method not allowed.");
      }
    } catch (err) {
      handleError(err, res);
    } finally {
      if (req.url?.startsWith("/api/")) {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });
}

// ---------- request parsing ----------

function limitBytes(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new HttpError(413, tooLargeMessage()));
      else cb(null, chunk);
    },
  });
}

function tooLargeMessage() {
  return `Photo is too large (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB). Try a smaller photo.`;
}

/** Turn the Node request into a WHATWG Request so we can use the built-in body parsers. */
function toWebRequest(req: IncomingMessage, maxBytes: number): Request {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > maxBytes) throw new HttpError(413, tooLargeMessage());
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const body = Readable.toWeb(req.pipe(limitBytes(maxBytes))) as ReadableStream<Uint8Array>;
  return new Request("http://local" + (req.url ?? "/"), {
    method: req.method,
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

async function readForm(req: IncomingMessage): Promise<FormData> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) {
    throw new HttpError(415, "Send the photo as multipart/form-data with a 'photo' field.");
  }
  try {
    // Small allowance on top of the photo for the other form fields.
    return await toWebRequest(req, config.maxUploadBytes + 64 * 1024).formData();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(400, "Could not read the upload.");
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  try {
    const body = await toWebRequest(req, 64 * 1024).json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, any>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Body must be a JSON object.");
  }
}

function formString(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" ? v : undefined;
}

async function readPhoto(form: FormData): Promise<PhotoInput> {
  const file = form.get("photo");
  if (!file || typeof file === "string") throw new HttpError(400, "Missing 'photo' file.");
  if (file.size > config.maxUploadBytes) throw new HttpError(413, tooLargeMessage());
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = sniffImageType(bytes);
  if (!mediaType) {
    throw new HttpError(415, "Unsupported photo format. Use JPEG, PNG, WebP or GIF.");
  }
  return { bytes, mediaType };
}

function parsePrefer(v: unknown): Preference {
  return v === "cheapest" || v === "fastest" ? v : "balanced";
}

// ---------- responses ----------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(json);
}

function handleError(err: unknown, res: ServerResponse): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.expose ? err.message : "Something went wrong." });
    return;
  }
  console.error(err);
  sendJson(res, 500, { error: "Something went wrong. Please try again." });
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowed = config.corsOrigins.split(",").map((s) => s.trim());
  if (allowed.includes("*")) res.setHeader("access-control-allow-origin", "*");
  else if (origin && allowed.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

// ---------- rate limiting (per IP, fixed one-minute window) ----------

const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimit(req: IncomingMessage): void {
  if (config.rateLimitPerMinute <= 0) return;
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : "") || req.socket.remoteAddress || "?";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    hits.set(ip, { count: 1, windowStart: now });
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.windowStart > 60_000) hits.delete(k);
    }
    return;
  }
  entry.count++;
  if (entry.count > config.rateLimitPerMinute) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
}

// ---------- static website ----------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(urlPath: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!config.webDir) throw new HttpError(404, "Not found.");
  const root = resolve(config.webDir);
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    throw new HttpError(400, "Bad path.");
  }
  let file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, "Not found.");

  let info = await stat(file).catch(() => undefined);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => undefined);
  }
  if (!info?.isFile()) throw new HttpError(404, "Not found.");

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
