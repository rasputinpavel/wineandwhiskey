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

  // Fast path: already analyzed before — but only trust a NON-empty cached entry.
  // (A failed earlier run could have stored empty evidence; ignore it and re-research,
  //  which overwrites the poisoned row.)
  const cached = key ? await getCached(key) : null;
  if (cached && hasSubstance(cached.evidence)) {
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

  // Never lose the wine: if structure didn't fill identity (e.g. research timed out
  // mid-search), seed it from the reliable identify step — so we show the wine and
  // a category-level read instead of a misleading "Unknown wine".
  if (!evidence.identity.producer && !evidence.identity.name && (identity.producer || identity.name)) {
    evidence.identity = identity;
  }

  const known = !!(evidence.identity.producer || evidence.identity.name);
  const substance = hasSubstance(evidence);

  // Truly nothing — not even an identity: a transient failure. Ask the user to retry
  // rather than show an empty card.
  if (!known && !substance) {
    throw new Error("empty extraction — likely a transient API failure");
  }

  // Cache only results that actually carry data — so a thin/timed-out research
  // re-runs next time instead of getting frozen into the cache.
  if (key && substance) await putCached(key, identity, evidence, brief);
  const v = assembleVerdict(evidence);
  v.detail = brief;
  return v;
}

/** True when the evidence carries real data worth reusing (beyond bare identity). */
function hasSubstance(e: Awaited<ReturnType<typeof structureEvidence>>): boolean {
  return (
    e.criticScores.length > 0 ||
    e.communityRating !== null ||
    e.priceObservations.length > 0 ||
    !!e.producerNote ||
    !!e.categoryPositioning ||
    !!e.tastingNotes
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
