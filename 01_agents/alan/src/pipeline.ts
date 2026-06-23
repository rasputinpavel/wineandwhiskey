import type { WineQuery, Verdict, AnaloguesResult } from "./types.js";
import { webSearchSource } from "./sources/websearch.js";
import type { WineDataSource } from "./sources/types.js";
import { researchSystemPrompt, analoguesSystemPrompt } from "./sommelier-prompt.js";
import { structureEvidence, structureAnalogues } from "./structure.js";
import { assembleVerdict } from "./assess.js";

/** Assess a wine: research → extract evidence → deterministic verdict. */
export async function assessWine(
  query: WineQuery,
  source: WineDataSource = webSearchSource,
): Promise<Verdict> {
  const { brief } = await source.research({
    query,
    systemPrompt: researchSystemPrompt(query.lang),
  });
  const evidence = await structureEvidence(brief, query.lang);
  return assembleVerdict(evidence);
}

/** Find global analogues: research → extract analogues. */
export async function findAnalogues(
  query: WineQuery,
  source: WineDataSource = webSearchSource,
): Promise<AnaloguesResult> {
  const { brief } = await source.research({
    query,
    systemPrompt: analoguesSystemPrompt(query.lang),
  });
  return structureAnalogues(brief, query.lang);
}
