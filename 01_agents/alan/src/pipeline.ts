import type { WineQuery, Verdict, AnaloguesResult, WineEvidence } from "./types.js";
import { webSearchSource } from "./sources/websearch.js";
import type { WineDataSource } from "./sources/types.js";
import { researchSystemPrompt, analoguesSystemPrompt } from "./sommelier-prompt.js";
import { structureEvidence, structureAnalogues } from "./structure.js";
import { assembleVerdict } from "./assess.js";
import { identifyWine, identityLabel, identityKey, type Identity } from "./identify.js";
import { getCached, putCached } from "./cache.js";

type OnProgress = (text: string) => void;

/** Assess a wine: fast identify (Haiku) → research (streamed) → extract (Haiku) → verdict.
 *  When a vintage was asked for but no year-specific data turns up, broaden the search to
 *  the wine in general and flag the verdict so the user is warned. */
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
    return finalize(cached.evidence, cached.brief, "");
  }

  // One research pass for a given identity: research → structure → seed identity.
  const researchAndStructure = async (q: WineQuery, id: Identity, hint: string) => {
    const { brief } = await source.research({
      query: q,
      systemPrompt: researchSystemPrompt(q.lang),
      onProgress,
      identityHint: hint || undefined,
    });
    const evidence = await structureEvidence(brief, q.lang);
    // Never lose the wine: if structure didn't fill identity (e.g. research timed out
    // mid-search), seed it from the reliable identify step — so we show the wine and
    // a category-level read instead of a misleading "Unknown wine".
    if (!evidence.identity.producer && !evidence.identity.name && (id.producer || id.name)) {
      evidence.identity = id;
    }
    return { evidence, brief };
  };

  // First pass: the wine exactly as identified (with its vintage, if any).
  let { evidence, brief } = await researchAndStructure(query, identity, label);
  let vintageFallback = "";

  // Vintage was specified but the year-specific signals (critics / crowd / price) are
  // all missing → drop the vintage and assess the wine in general, warning the user.
  if (identity.vintage && lacksVintageData(evidence)) {
    const broadId: Identity = { ...identity, vintage: "" };
    const broadLabel = identityLabel(broadId);
    const broadKey = identityKey(broadId);
    onProgress?.(`${label}\nПо винтажу ${identity.vintage} данных мало — смотрю вино в целом…\n`);

    const broadCached = broadKey ? await getCached(broadKey) : null;
    if (broadCached && hasSubstance(broadCached.evidence)) {
      evidence = broadCached.evidence;
      brief = broadCached.brief;
      vintageFallback = identity.vintage;
    } else {
      const broadQuery: WineQuery = { ...query, text: stripVintage(query.text, identity.vintage) };
      const broad = await researchAndStructure(broadQuery, broadId, broadLabel);
      if (hasSubstance(broad.evidence)) {
        evidence = broad.evidence;
        brief = broad.brief;
        vintageFallback = identity.vintage;
        if (broadKey) await putCached(broadKey, broadId, evidence, brief);
      }
    }
  } else if (key && hasSubstance(evidence)) {
    // Normal path: cache the exact-vintage result when it carries data — so a
    // thin/timed-out research re-runs next time instead of freezing into the cache.
    await putCached(key, identity, evidence, brief);
  }

  // Truly nothing — not even an identity: a transient failure. Ask the user to retry
  // rather than show an empty card.
  const known = !!(evidence.identity.producer || evidence.identity.name);
  if (!known && !hasSubstance(evidence)) {
    throw new Error("empty extraction — likely a transient API failure");
  }

  return finalize(evidence, brief, vintageFallback);
}

/** Assemble the verdict, attach the full brief, and flag a vintage fallback if any. */
function finalize(evidence: WineEvidence, brief: string, vintageFallback: string): Verdict {
  const v = assembleVerdict(evidence);
  v.detail = brief;
  if (vintageFallback) v.vintageFallback = vintageFallback;
  return v;
}

/** True when the evidence carries real data worth reusing (beyond bare identity). */
function hasSubstance(e: WineEvidence): boolean {
  return (
    e.criticScores.length > 0 ||
    e.communityRating !== null ||
    e.priceObservations.length > 0 ||
    !!e.producerNote ||
    !!e.categoryPositioning ||
    !!e.tastingNotes
  );
}

/** True when no *vintage-specific* signal was found — critics, crowd and prices are all
 *  year-dependent; producer/category prose is not, so it doesn't count here. */
export function lacksVintageData(e: WineEvidence): boolean {
  return (
    e.criticScores.length === 0 &&
    e.communityRating === null &&
    e.priceObservations.length === 0
  );
}

/** Remove the vintage year token from a typed query, collapsing leftover whitespace. */
export function stripVintage(text: string, vintage: string): string {
  if (!text || !vintage) return text;
  const escaped = vintage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}\\b`, "g"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
