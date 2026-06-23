import type { WineQuery } from "../types.js";

export interface ResearchInput {
  query: WineQuery;
  systemPrompt: string;
  onProgress?: (text: string) => void; // called with accumulated narration as it streams
}

export interface ResearchResult {
  brief: string;     // model's factual research text (with inline source mentions)
}

/** The seam. MVP impl = WebSearchSource. Future: VivinoSource, LwinSource, LivexSource. */
export interface WineDataSource {
  research(input: ResearchInput): Promise<ResearchResult>;
}
