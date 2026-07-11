import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_CHEAP } from "../config.js";
import type { Lang } from "../types.js";
import type { RankPick } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "number" },
          why: { type: "string" },
          qualityVsAnchor: { type: "string", enum: ["lower", "similar", "higher"] },
        },
        required: ["ref", "why", "qualityVsAnchor"],
      },
    },
  },
  required: ["picks"],
} as const;

/** Pick up to 3 candidates closest in STYLE to the anchor wine. Returns [] on any
 *  failure/refusal. `candidates[i].ref` is the caller's index back into the full data. */
export async function rankCandidates(
  anchorLabel: string,
  anchorNote: string,
  candidates: { ref: number; text: string }[],
  lang: Lang,
): Promise<RankPick[]> {
  if (candidates.length === 0) return [];
  const list = candidates.map((c) => `${c.ref}. ${c.text}`).join("\n");
  const system = [
    "You match wines. Given an ANCHOR wine and a numbered CANDIDATE list, pick up to 3",
    "candidates closest to the anchor in STYLE (grape, body, sweetness, region character)",
    "and overall quality level. Choose ONLY from the list. If nothing is a real match,",
    "return an empty picks array — do not stretch. For each pick: ref = the candidate's",
    "number exactly as shown; why = ONE short line; qualityVsAnchor = the candidate's",
    `quality relative to the anchor (lower/similar/higher). Write "why" in`,
    `${lang === "ru" ? "Russian" : "English"}. Never invent wines not in the list.`,
  ].join(" ");
  const user = `ANCHOR: ${anchorLabel}${anchorNote ? ` (${anchorNote})` : ""}\n\nCANDIDATES:\n${list}`;

  const params = {
    model: MODEL_CHEAP,
    max_tokens: 1500,
    system,
    output_config: { format: { type: "json_schema", schema: RANK_SCHEMA } },
    messages: [{ role: "user", content: user }],
  } as any;

  try {
    const resp = await anthropic.messages.create(params);
    if (resp.stop_reason === "refusal") return [];
    const txt = resp.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(txt) as { picks: RankPick[] };
    const valid = new Set(candidates.map((c) => c.ref));
    return parsed.picks.filter((p) => valid.has(p.ref)).slice(0, 3);
  } catch (err) {
    console.error("rank failed:", err);
    return [];
  }
}
