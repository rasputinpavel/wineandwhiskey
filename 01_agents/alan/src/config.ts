import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import type { Lang } from "./types.js";

export const TELEGRAM_TOKEN = process.env.ALAN_BOT_TOKEN!;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export const MODEL_MAIN = "claude-opus-4-8";

/** Reply language when the message carries no detectable text (e.g. bare photo). */
export const DEFAULT_LANG: Lang = "ru";

/** Session time-to-live (ms) — drops follow-up context after inactivity. */
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export function assertEnv(): void {
  const missing = [
    ["ALAN_BOT_TOKEN", TELEGRAM_TOKEN],
    ["ANTHROPIC_API_KEY", ANTHROPIC_API_KEY],
    ["OPENAI_API_KEY", OPENAI_API_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}
