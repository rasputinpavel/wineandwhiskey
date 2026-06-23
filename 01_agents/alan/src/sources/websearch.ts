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

    let response = await anthropic.messages.create({
      model: MODEL_MAIN,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: input.systemPrompt,
      tools: WEB_TOOLS as any,
      messages,
    });

    let continuations = 0;
    while (response.stop_reason === "pause_turn" && continuations < MAX_CONTINUATIONS) {
      messages.push({ role: "assistant", content: response.content });
      response = await anthropic.messages.create({
        model: MODEL_MAIN,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: input.systemPrompt,
        tools: WEB_TOOLS as any,
        messages,
      });
      continuations++;
    }

    const brief = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { brief };
  },
};
