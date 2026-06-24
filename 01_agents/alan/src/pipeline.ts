import type { WineQuery, Verdict, AnaloguesResult } from "./types.js";
import { webSearchSource } from "./sources/websearch.js";
import type { WineDataSource } from "./sources/types.js";
import { researchSystemPrompt, analoguesSystemPrompt } from "./sommelier-prompt.js";
import { structureEvidence, structureAnalogues } from "./structure.js";
import { assembleVerdict } from "./assess.js";
import { identifyWine, identityLabel, identityKey } from "./identify.js";
import { getCached, putCached } from "./cache.js";

type OnProgress = (text: string) => void;

/** Assess a wine: fast identify (Haiku) → research (streamed) → extract (Haiku) → verdict. */
export async function assessWine(
  query: WineQuery,
  onProgress?: OnProgress,
  source: WineDataSource = webSearchSource,
): Promise<Verdict> {
  const identity = await identifyWine(query);
  const label = identityLabel(identity);
  if (label) onProgress?.(`Вижу: ${label}\n`);

  const key = identityKey(identity);

  // Fast path: already analyzed before.
  const cached = key ? await getCached(key) : null;
  if (cached) {
    onProgress?.(`Вижу: ${label}\nУже знаю это вино — отдаю готовый разбор.`);
    const v = assembleVerdict(cached.evidence);
    v.detail = cached.brief;
    return v;
  }

  const { brief } = await source.research({
    query,
    systemPrompt: researchSystemPrompt(query.lang),
    onProgress,
    identityHint: label || undefined,
  });
  const evidence = await structureEvidence(brief, query.lang);
  if (key) await putCached(key, identity, evidence, brief);
  const v = assembleVerdict(evidence);
  v.detail = brief;
  return v;
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
