import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_CHEAP } from "./config.js";
import type { WineQuery, WineEvidence } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export type Identity = WineEvidence["identity"];

const IDENTITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    producer: { type: "string" },
    name: { type: "string" },
    vintage: { type: "string" },
    region: { type: "string" },
    grape: { type: "string" },
    type: { type: "string" },
    idConfidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["producer", "name", "vintage", "region", "grape", "type", "idConfidence"],
} as const;

function content(query: WineQuery): any[] {
  const blocks: any[] = [];
  for (const img of query.images) {
    blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  const text = query.text.trim();
  blocks.push({
    type: "text",
    text: text
      ? `Identify this wine: ${text}`
      : "Identify the wine from the label photo(s). Front and back of one bottle may be shown.",
  });
  return blocks;
}

/** Fast, cheap identification (Haiku). Reads the label; does NOT research. */
export async function identifyWine(query: WineQuery): Promise<Identity> {
  const params = {
    model: MODEL_CHEAP,
    max_tokens: 700,
    system:
      'Identify the wine from the photo(s)/text. Fill producer, name, vintage ("" if non-vintage/unknown), grape, region, and type (red/white/sparkling/rosé/fortified/""). Set idConfidence. Use ONLY what you can read or directly infer — do not research or guess wildly. Output the JSON only.',
    output_config: { format: { type: "json_schema", schema: IDENTITY_SCHEMA } },
    messages: [{ role: "user", content: content(query) }],
  } as any;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await anthropic.messages.create(params);
      const txt = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return JSON.parse(txt) as Identity;
    } catch (err) {
      console.error(`identify attempt ${attempt} failed:`, err);
    }
  }
  return { producer: "", name: "", vintage: "", region: "", grape: "", type: "", idConfidence: "low" };
}

/** Human label for progress/echo, e.g. "MontGras Day One 2020". */
export function identityLabel(id: Identity): string {
  return [id.producer, id.name, id.vintage].filter(Boolean).join(" ").trim();
}

/** Research hint: the label plus the color/style read off the bottle, e.g.
 *  "Château Haut-Vigneau 2020 (white)". Carrying the color forward stops the
 *  researcher from hedging both cuvées for a château that makes red AND white. */
export function identityHint(id: Identity): string {
  const label = identityLabel(id);
  const type = id.type.trim();
  return label && type ? `${label} (${type})` : label;
}

/** Normalized cache key from producer + name + vintage. */
export function identityKey(id: Identity): string {
  return [id.producer, id.name, id.vintage]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}
