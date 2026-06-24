import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "./config.js";
import { EVIDENCE_SCHEMA, ANALOGUES_SCHEMA } from "./sommelier-prompt.js";
import type { WineEvidence, AnaloguesResult, Lang } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

/** Returned when the model refuses or emits unparseable output — drives the
 *  honest "not enough data" path in assembleVerdict rather than a hard failure. */
const EMPTY_EVIDENCE: WineEvidence = {
  identity: { producer: "", name: "", vintage: "", region: "", grape: "", type: "", idConfidence: "low" },
  criticScores: [],
  communityRating: null,
  priceObservations: [],
  tastingNotes: "",
  drinkingWindow: "",
  producerNote: "",
  categoryPositioning: "",
  evidenceLevel: "none",
  valueRead: "unknown",
  priceTier: "unknown",
  dataConfidence: "low",
  sources: [],
};

const EMPTY_ANALOGUES: AnaloguesResult = {
  forWine: "",
  analogues: [],
  dataConfidence: "low",
  sources: [],
};

async function structured<T>(brief: string, schema: unknown, instruction: string, fallback: T, lang: Lang): Promise<T> {
  const response = await anthropic.messages.create({
    model: MODEL_MAIN,
    max_tokens: 4000,
    system: `${instruction}\nUse ONLY facts present in the research brief. Do not add data that is not in the brief. Empty/zero/"" for anything the brief does not establish.\nWrite any human-readable prose fields (tastingNotes, drinkingWindow, analogues' "why") in ${lang === "ru" ? "Russian" : "English"}.`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: brief }],
  } as any);

  if (response.stop_reason === "refusal") return fallback;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function structureEvidence(brief: string, lang: Lang): Promise<WineEvidence> {
  return structured<WineEvidence>(
    brief, EVIDENCE_SCHEMA,
    "Extract structured wine evidence from this research brief. Set evidenceLevel to the most specific tier the brief actually supports (exact/producer/category/none), and valueRead to the brief's qualitative price read (good/fair/steep/unknown). Capture producerNote and categoryPositioning verbatim-ish from the brief. Set priceTier to the band the brief implies (entry/mid/premium/luxury/icon, or unknown).",
    EMPTY_EVIDENCE,
    lang,
  );
}

export function structureAnalogues(brief: string, lang: Lang): Promise<AnaloguesResult> {
  return structured<AnaloguesResult>(
    brief, ANALOGUES_SCHEMA,
    "Extract the analogue recommendations from this research brief.",
    EMPTY_ANALOGUES,
    lang,
  );
}
