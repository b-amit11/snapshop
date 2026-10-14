import { config } from "./config.js";
import type { Confidence, ItemIdentification } from "./types.js";
import { hash, HttpError, withTimeout } from "./util.js";

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export interface PhotoInput {
  bytes: Uint8Array;
  mediaType: ImageType;
}

export interface IdentifyResult {
  item: ItemIdentification;
  demo: boolean;
}

const SYSTEM_PROMPT = `You help shoppers buy the exact item shown in a photo.
Identify the single main purchasable product in the image. Read any visible text carefully:
brand names, model numbers, sizes (for tires, the sidewall code like 225/65R17 98H), dimensions,
quantities, colors and materials. Prefer specific facts you can see over guesses.

Then call report_item:
- name: short, specific, shopper-friendly product name.
- searchQuery: what a shopper should type into Amazon/Google Shopping to find this exact item
  (include brand/model/size when known; otherwise the most useful generic description).
- storeTypes: 1-3 kinds of physical stores near the shopper that are likely to stock it
  (e.g. "tire shop", "auto parts store", "hardware store", "shoe store", "grocery store").
- attributes: the specs you could read or confidently infer (size, color, length, count...).
- confidence: high if brand/model/size are legible, medium if the type is clear but specs are not,
  low if you are unsure what the product is.
- notes: one short tip on what to double-check before buying (e.g. "Confirm load index on your
  current tire"), or what photo would help.
If the photo shows no product (a person, a landscape...), set confidence to low, name to
"No product found", and explain in notes. Never identify people.`;

const REPORT_TOOL = {
  name: "report_item",
  description: "Report the product identified in the shopper's photo.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      brand: { type: "string", description: "Brand if visible or certain; omit otherwise." },
      category: {
        type: "string",
        description: "Broad category, e.g. auto parts, hardware, footwear, clothing, grocery, electronics, home.",
      },
      attributes: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Specs like size, color, length, model number, count.",
      },
      searchQuery: { type: "string" },
      storeTypes: { type: "array", items: { type: "string" }, maxItems: 3 },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "string" },
    },
    required: ["name", "category", "attributes", "searchQuery", "storeTypes", "confidence"],
  },
} as const;

/** Identify the product in a photo. Falls back to demo data when no API key is set. */
export async function identifyItem(
  photo: PhotoInput,
  hint?: string,
  signal?: AbortSignal,
): Promise<IdentifyResult> {
  if (!config.anthropicApiKey || config.forceDemo) {
    return { item: demoIdentification(photo.bytes, hint), demo: true };
  }
  return { item: await identifyWithClaude(photo, hint, signal), demo: false };
}

async function identifyWithClaude(photo: PhotoInput, hint?: string, signal?: AbortSignal): Promise<ItemIdentification> {
  const userText = hint?.trim()
    ? `Identify this item so I can buy it. My note about it: "${hint.trim().slice(0, 300)}"`
    : "Identify this item so I can buy it.";

  const body = {
    model: config.claudeModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: REPORT_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: photo.mediaType, data: Buffer.from(photo.bytes).toString("base64") },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 45_000),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach the image recognition service: ${(err as Error).message}`);
  }

  const json = (await res.json().catch(() => ({}))) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg = json.error?.message ?? `status ${res.status}`;
    // 400s here are usually a bad image; others are service problems.
    throw new HttpError(res.status === 400 ? 422 : 502, `Image recognition failed: ${msg}`);
  }

  const toolUse = json.content?.find((c) => c.type === "tool_use" && c.name === REPORT_TOOL.name);
  if (!toolUse) throw new HttpError(502, "Image recognition returned no result.");
  return normalizeIdentification(toolUse.input);
}

/** Validate and clean the model's tool input into an ItemIdentification. */
export function normalizeIdentification(raw: unknown): ItemIdentification {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const name = str(r.name) || "Unknown item";
  const attributes: Record<string, string> = {};
  if (r.attributes && typeof r.attributes === "object") {
    for (const [k, v] of Object.entries(r.attributes as Record<string, unknown>).slice(0, 12)) {
      if (typeof v === "string" || typeof v === "number") attributes[k.slice(0, 40)] = String(v).slice(0, 80);
    }
  }
  const storeTypes = Array.isArray(r.storeTypes)
    ? r.storeTypes.map((s) => str(s, 40)).filter(Boolean).slice(0, 3)
    : [];
  const confidence: Confidence = ["high", "medium", "low"].includes(r.confidence as string)
    ? (r.confidence as Confidence)
    : "low";

  return {
    name,
    brand: str(r.brand, 80) || undefined,
    category: str(r.category, 60) || "general",
    attributes,
    searchQuery: str(r.searchQuery) || name,
    storeTypes: storeTypes.length ? storeTypes : ["department store"],
    confidence,
    notes: str(r.notes, 300) || undefined,
  };
}

const DEMO_ITEMS: ItemIdentification[] = [
  {
    name: "Michelin Defender2 all-season tire 225/65R17",
    brand: "Michelin",
    category: "auto parts",
    attributes: { size: "225/65R17", "load/speed": "102H", season: "all-season" },
    searchQuery: "Michelin Defender2 225/65R17 tire",
    storeTypes: ["tire shop", "auto parts store"],
    confidence: "high",
    notes: "Check the load index on your current tire before ordering.",
  },
  {
    name: "Flat athletic shoelaces, white, 54 inch",
    category: "footwear",
    attributes: { color: "white", length: "54 in", style: "flat" },
    searchQuery: "white flat athletic shoelaces 54 inch",
    storeTypes: ["shoe store", "department store"],
    confidence: "medium",
    notes: "Count the eyelet pairs: 6 pairs usually needs 54 in laces.",
  },
  {
    name: "Common wire nails 3 inch (10d), 1 lb box",
    category: "hardware",
    attributes: { length: "3 in", size: "10d", finish: "bright" },
    searchQuery: "10d common nails 3 inch 1 lb",
    storeTypes: ["hardware store", "home improvement store"],
    confidence: "medium",
  },
];

/** Deterministic fake identification used when ANTHROPIC_API_KEY is not set. */
export function demoIdentification(bytes: Uint8Array, hint?: string): ItemIdentification {
  const h = hint?.trim();
  if (h) {
    return {
      name: h.slice(0, 120),
      category: "general",
      attributes: {},
      searchQuery: h.slice(0, 200),
      storeTypes: ["department store", "hardware store"],
      confidence: "low",
      notes: "Demo mode: add ANTHROPIC_API_KEY to identify photos for real.",
    };
  }
  const item = DEMO_ITEMS[hash(bytes) % DEMO_ITEMS.length]!;
  return { ...item, notes: `Demo mode: add ANTHROPIC_API_KEY to identify photos for real. ${item.notes ?? ""}`.trim() };
}

/** Detect the real image type from magic bytes (don't trust the client's label). */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return undefined;
}
