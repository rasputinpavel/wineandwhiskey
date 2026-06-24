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

  // If extraction came back completely empty (e.g. a transient API failure during
  // identify+research+structure), don't show a misleading "Unknown wine" card —
  // surface it as a retry to handleQuery and don't cache the empty result.
  if (isEmptyEvidence(evidence)) {
    throw new Error("empty extraction — likely a transient API failure");
  }

  if (key) await putCached(key, identity, evidence, brief);
  const v = assembleVerdict(evidence);
  v.detail = brief;
  return v;
}

/** True when we got nothing usable — no identity, no data, no positioning. */
function isEmptyEvidence(e: Awaited<ReturnType<typeof structureEvidence>>): boolean {
  return (
    !e.identity.producer && !e.identity.name &&
    e.criticScores.length === 0 &&
    e.communityRating === null &&
    e.priceObservations.length === 0 &&
    !e.producerNote && !e.categoryPositioning && !e.tastingNotes
  );
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
