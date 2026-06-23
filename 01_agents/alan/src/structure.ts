import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "./config.js";
import { EVIDENCE_SCHEMA, ANALOGUES_SCHEMA } from "./sommelier-prompt.js";
import type { WineEvidence, AnaloguesResult } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function structured<T>(brief: string, schema: unknown, instruction: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: MODEL_MAIN,
    max_tokens: 4000,
    system: `${instruction}\nUse ONLY facts present in the research brief. Do not add data that is not in the brief. Empty/zero/"" for anything the brief does not establish.`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: brief }],
  } as any);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as T;
}

export function structureEvidence(brief: string): Promise<WineEvidence> {
  return structured<WineEvidence>(
    brief, EVIDENCE_SCHEMA,
    "Extract structured wine evidence from this research brief.",
  );
}

export function structureAnalogues(brief: string): Promise<AnaloguesResult> {
  return structured<AnaloguesResult>(
    brief, ANALOGUES_SCHEMA,
    "Extract the analogue recommendations from this research brief.",
  );
}
