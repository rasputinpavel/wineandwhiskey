import type { WineQuery } from "../types.js";

export interface ResearchInput {
  query: WineQuery;
  systemPrompt: string;
}

export interface ResearchResult {
  brief: string;     // model's factual research text (with inline source mentions)
}

/** The seam. MVP impl = WebSearchSource. Future: VivinoSource, LwinSource, LivexSource. */
export interface WineDataSource {
  research(input: ResearchInput): Promise<ResearchResult>;
}
