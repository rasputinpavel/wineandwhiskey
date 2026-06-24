import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "../config.js";
import type { WineDataSource, ResearchInput, ResearchResult } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
] as const;

const MAX_CONTINUATIONS = 2;          // pause_turn resume legs
const RESEARCH_TIMEOUT_MS = 90_000;   // hard ceiling so the bot never appears hung

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
    let brief = "";      // model narration/text only (fed to structure)
    let display = "";    // narration + search-activity notes (shown live)

    const ac = new AbortController();
    const deadline = setTimeout(() => ac.abort(), RESEARCH_TIMEOUT_MS);

    try {
      for (let leg = 0; leg <= MAX_CONTINUATIONS; leg++) {
        const stream = anthropic.messages.stream(
          {
            model: MODEL_MAIN,
            max_tokens: 8000,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system: input.systemPrompt,
            tools: WEB_TOOLS as any,
            messages,
          } as any,
          { signal: ac.signal },
        );

        // Iterate raw events: append text deltas to brief/display, and surface
        // a "searching…" note when the model issues a web_search/web_fetch.
        for await (const event of stream as any) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            brief += event.delta.text;
            display += event.delta.text;
            input.onProgress?.(display);
          } else if (
            event.type === "content_block_start" &&
            event.content_block?.type === "server_tool_use"
          ) {
            const q = event.content_block?.input?.query;
            display += q ? `\n🔍 ${q}\n` : "\n🔍 ищу…\n";
            input.onProgress?.(display);
          }
        }

        const msg = await stream.finalMessage();
        if (msg.stop_reason === "pause_turn" && leg < MAX_CONTINUATIONS) {
          messages.push({ role: "assistant", content: msg.content });
          continue;
        }
        break;
      }
    } catch (err: any) {
      // Timeout/abort or stream error: proceed with whatever we gathered.
      // The cascade + structure fallback still yields a producer/category verdict.
      if (ac.signal.aborted) {
        console.warn("research timed out; proceeding with partial brief");
      } else {
        console.error("research stream error:", err);
      }
    } finally {
      clearTimeout(deadline);
    }

    return { brief: brief.trim() };
  },
};
