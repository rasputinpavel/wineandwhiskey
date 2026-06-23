import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_CHEAP } from "./config.js";
import type { Lang } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export type TriageKind = "assess" | "analogues" | "chat";
export interface Triage {
  kind: TriageKind;
  reply: string; // conversational reply for "chat"; "" for assess/analogues
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["assess", "analogues", "chat"] },
    reply: { type: "string" },
  },
  required: ["kind", "reply"],
} as const;

function system(lang: Lang): string {
  const langName = lang === "ru" ? "Russian" : "English";
  return [
    "You are Алан, a blunt, honest sommelier bot. Classify the user's message into one kind:",
    '- "assess": they named or asked about a SPECIFIC wine to evaluate.',
    '- "analogues": they want similar wines / a substitute for a SPECIFIC wine.',
    '- "chat": a greeting, small talk, a question about what you can do, or a GENERAL',
    "  wine question (grapes, regions, pairings, advice) with no specific bottle to look up.",
    "",
    `For "chat", write a brief, warm-but-blunt reply in ${langName} in your sommelier voice.`,
    "If they ask what you can do, tell them: you assess a specific wine honestly from a photo,",
    "a typed name, or a voice note (what it is, what critics and the crowd say, and whether",
    "it's worth its price), and you can suggest analogues. Answer general wine questions from",
    "your own knowledge, concisely.",
    `For "assess" and "analogues", set reply to "" — the bot runs a separate research step.`,
  ].join("\n");
}

/** Decide whether a text message is a wine to assess, an analogues request, or
 *  general chat — and for chat, produce the reply. Fast/cheap (Haiku), no web search.
 *  On any error, default to treating it as a wine to assess. */
export async function triage(text: string, lang: Lang): Promise<Triage> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL_CHEAP,
      max_tokens: 1000,
      system: system(lang),
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: text }],
    } as any);

    const out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return JSON.parse(out) as Triage;
  } catch (err) {
    console.error("triage failed, defaulting to assess:", err);
    return { kind: "assess", reply: "" };
  }
}
