import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "../config.js";
import type { WineDataSource, ResearchInput, ResearchResult } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
] as const;

const MAX_CONTINUATIONS = 4;

function userContent(input: ResearchInput): Anthropic.MessageParam["content"] {
  const blocks: any[] = [];
  for (const img of input.query.images) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  const text = input.query.text.trim();
  blocks.push({
    type: "text",
    text: text
      ? text
      : "Identify the wine in the photo(s) and research it as instructed. Multiple photos may be the front and back label of the SAME bottle — treat them as one wine.",
  });
  return blocks;
}

export const webSearchSource: WineDataSource = {
  async research(input: ResearchInput): Promise<ResearchResult> {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userContent(input) },
    ];
    let accumulated = "";

    // Stream the research; resume across pause_turn (server-side web-search loop limit).
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const stream = anthropic.messages.stream({
        model: MODEL_MAIN,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: input.systemPrompt,
        tools: WEB_TOOLS as any,
        messages,
      } as any);

      stream.on("text", (delta: string) => {
        accumulated += delta;
        input.onProgress?.(accumulated);
      });

      const msg = await stream.finalMessage();
      if (msg.stop_reason === "pause_turn" && i < MAX_CONTINUATIONS) {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      break;
    }

    return { brief: accumulated.trim() };
  },
};
