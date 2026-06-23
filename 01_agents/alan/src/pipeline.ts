import type { WineQuery, Verdict, AnaloguesResult } from "./types.js";
import { webSearchSource } from "./sources/websearch.js";
import type { WineDataSource } from "./sources/types.js";
import { researchSystemPrompt, analoguesSystemPrompt } from "./sommelier-prompt.js";
import { structureEvidence, structureAnalogues } from "./structure.js";
import { assembleVerdict } from "./assess.js";

type OnProgress = (text: string) => void;

/** Assess a wine: research (streamed via onProgress) → extract evidence → verdict. */
export async function assessWine(
  query: WineQuery,
  onProgress?: OnProgress,
  source: WineDataSource = webSearchSource,
): Promise<Verdict> {
  const { brief } = await source.research({
    query,
    systemPrompt: researchSystemPrompt(query.lang),
    onProgress,
  });
  const evidence = await structureEvidence(brief, query.lang);
  return assembleVerdict(evidence);
}

/** Find global analogues: research (streamed) → extract analogues. */
export async function findAnalogues(
  query: WineQuery,
  onProgress?: OnProgress,
  source: WineDataSource = webSearchSource,
): Promise<AnaloguesResult> {
  const { brief } = await source.research({
    query,
    systemPrompt: analoguesSystemPrompt(query.lang),
    onProgress,
  });
  return structureAnalogues(brief, query.lang);
}
