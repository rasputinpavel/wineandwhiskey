// Одноразовый импорт истории Telegram-чата с Бэрримором
// в conversation_messages + chronicle (для search_memory).
//
// Запуск (из 01_agents/barrymore):
//   npx tsx scripts/import_history.ts
//
// Параметры (CLI / env):
//   --chat-id=292851454       chat_id личного DM с Бэрримором (обязательно)
//   --html=path/to/messages.html  путь к экспортированному HTML
//   --voice-dir=path/to/voice_messages
//   --reset                   удалить существующие conversation_messages для chat_id перед импортом
//   --dry-run                 распарсить и показать сводку, ничего не писать в БД

import { File as NodeFile } from "node:buffer";
if (!globalThis.File) (globalThis as any).File = NodeFile;

import dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI, { toFile } from "openai";

dotenv.config({ path: resolve(process.cwd(), "../../.env.local") });

// --- CLI args ---

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? "true");
}

const CHAT_ID    = Number(args.get("chat-id") ?? "292851454");
const HTML_PATH  = args.get("html")      ?? resolve(process.cwd(), "../../.inbox/chat_export/messages.html");
const VOICE_DIR  = args.get("voice-dir") ?? resolve(process.cwd(), "../../.inbox/chat_export/voice_messages");
const RESET      = args.has("reset");
const DRY_RUN    = args.has("dry-run");
const NOTE_MIN   = 200;

if (!CHAT_ID || Number.isNaN(CHAT_ID)) {
  console.error("Usage: --chat-id=<number>");
  process.exit(1);
}
if (!existsSync(HTML_PATH)) {
  console.error(`HTML not found: ${HTML_PATH}`);
  process.exit(1);
}

// --- Supabase + OpenAI ---

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// --- Parse messages.html ---

interface ParsedMessage {
  id:        string;
  ts:        string;          // ISO timestamp
  weekday:   string;
  date:      string;          // YYYY-MM-DD (Bangkok)
  time:      string;          // HH:MM
  fromName:  string;
  joined:    boolean;
  voiceFile?: string;
  text?:     string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a [^>]*onclick="return ShowBotCommand\(&quot;([^&]+)&quot;\)"[^>]*>[^<]*<\/a>/g, "/$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseTitle(title: string): { iso: string; weekday: string; date: string; time: string } {
  // "25.04.2026 22:32:35 UTC+07:00"
  const m = title.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-]\d{2}:\d{2})$/);
  if (!m) throw new Error(`Bad title: ${title}`);
  const [, dd, mm, yyyy, hh, min, ss, tz] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${tz}`;
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("ru-RU", { weekday: "long", timeZone: "Asia/Bangkok" });
  const date    = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const time    = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok" }).slice(0, 5);
  return { iso, weekday, date, time };
}

function parseHtml(html: string): ParsedMessage[] {
  // Each message div contains: id="messageNNNN", title="...", optional from_name, text or voice link.
  // Split by message div start.
  const chunks = html.split(/<div class="message default clearfix( joined)?" id="(message[^"]+)">/);
  // chunks[0] is preamble; then groups of 3: [joinedFlag, id, body]
  const messages: ParsedMessage[] = [];

  for (let i = 1; i < chunks.length; i += 3) {
    const joinedFlag = chunks[i] === " joined";
    const id         = chunks[i + 1];
    const body       = chunks[i + 2];

    // Body ends at the next message div (already split out) — take everything until end of chunk.
    const titleMatch = body.match(/title="([^"]+)"/);
    if (!titleMatch) continue;
    const { iso, weekday, date, time } = parseTitle(titleMatch[1]);

    const fromMatch = body.match(/<div class="from_name">\s*([^<]+?)\s*<\/div>/);
    const fromName  = fromMatch ? fromMatch[1].trim() : "";

    const voiceMatch = body.match(/href="(voice_messages\/[^"]+\.ogg)"/);

    let text: string | undefined;
    if (!voiceMatch) {
      // Get the .text div content. It might contain HTML (br, a, strong).
      const textMatch = body.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (textMatch) text = htmlToText(textMatch[1]);
    }

    messages.push({
      id,
      ts: iso,
      weekday,
      date,
      time,
      fromName,
      joined: joinedFlag,
      voiceFile: voiceMatch ? voiceMatch[1] : undefined,
      text,
    });
  }

  // Apply joined inheritance: empty fromName inherits from previous message.
  let lastFrom = "";
  for (const m of messages) {
    if (m.fromName) lastFrom = m.fromName;
    else m.fromName = lastFrom;
  }

  return messages;
}

// --- Voice transcription ---

async function transcribeFile(absPath: string): Promise<string | null> {
  if (!existsSync(absPath)) {
    console.warn(`  voice file missing: ${absPath}`);
    return null;
  }
  try {
    const buf  = readFileSync(absPath);
    const file = await toFile(buf, "voice.ogg", { type: "audio/ogg" });
    const r = await openai.audio.transcriptions.create({
      file,
      model:    "whisper-1",
      language: "ru",
    });
    return (r.text ?? "").trim() || null;
  } catch (err) {
    console.error(`  whisper failed for ${absPath}:`, err);
    return null;
  }
}

// --- Main ---

async function main() {
  console.log(`Reading ${HTML_PATH}`);
  const html = readFileSync(HTML_PATH, "utf8");
  const parsed = parseHtml(html);
  console.log(`Parsed ${parsed.length} messages (${parsed.filter((m) => m.voiceFile).length} voice).`);

  // Transcribe voices
  for (const m of parsed) {
    if (!m.voiceFile) continue;
    const abs = resolve(VOICE_DIR, m.voiceFile.replace(/^voice_messages\//, ""));
    process.stdout.write(`  whisper: ${m.voiceFile} ... `);
    const t = await transcribeFile(abs);
    if (t) {
      m.text = `[голосовое] ${t}`;
      console.log(`${t.length} chars`);
    } else {
      m.text = "[голосовое: расшифровка не удалась]";
      console.log("FAILED");
    }
  }

  // Build conversation_messages rows
  const SENDER_NAME = "pavel"; // matches identifyUser("pavelrasputin") at runtime

  const convoRows = parsed
    .filter((m) => m.text && m.text.length > 0)
    .map((m) => {
      const isAssistant = /^Бэррим/i.test(m.fromName);
      const role: "user" | "assistant" = isAssistant ? "assistant" : "user";
      const content =
        role === "user"
          ? `[${m.weekday}, ${m.date}, ${m.time}] ${SENDER_NAME}: ${m.text}`
          : (m.text as string);
      return {
        chat_id: CHAT_ID,
        role,
        content,
        ts:      m.ts,
      };
    });

  // Build chronicle 'note' entries for long user messages (and all transcribed voices)
  const noteRows = parsed
    .filter((m) => m.text && !/^Бэррим/i.test(m.fromName))
    .filter((m) => (m.voiceFile && m.text) || (m.text && m.text.length >= NOTE_MIN))
    .map((m) => {
      const cleanText = (m.text as string).replace(/^\[голосовое\]\s*/, "");
      const titleSrc  = cleanText.replace(/\s+/g, " ").slice(0, 60);
      const tag       = m.voiceFile ? "[голосовое] " : "";
      return {
        date:        m.date,
        event_type:  "note",
        title:       `${tag}${titleSrc}${cleanText.length > 60 ? "…" : ""}`,
        description: cleanText,
      };
    });

  console.log(`\nWill insert: ${convoRows.length} conversation rows, ${noteRows.length} chronicle notes.`);
  if (DRY_RUN) {
    console.log("\n--- sample conversation rows ---");
    for (const r of convoRows.slice(0, 5)) {
      console.log(`[${r.ts}] ${r.role}: ${(r.content as string).slice(0, 120)}`);
    }
    console.log("\n--- sample notes ---");
    for (const n of noteRows.slice(0, 5)) {
      console.log(`[${n.date}] ${n.title}`);
    }
    return;
  }

  if (RESET) {
    console.log(`Deleting existing conversation_messages for chat_id=${CHAT_ID}...`);
    const { error } = await supabase
      .from("conversation_messages")
      .delete()
      .eq("chat_id", CHAT_ID);
    if (error) throw new Error(`reset failed: ${error.message}`);
  }

  // Bulk insert in batches of 100
  for (let i = 0; i < convoRows.length; i += 100) {
    const slice = convoRows.slice(i, i + 100);
    const { error } = await supabase.from("conversation_messages").insert(slice);
    if (error) throw new Error(`insert convo: ${error.message}`);
    console.log(`  conversation_messages: ${Math.min(i + 100, convoRows.length)}/${convoRows.length}`);
  }
  for (let i = 0; i < noteRows.length; i += 100) {
    const slice = noteRows.slice(i, i + 100);
    const { error } = await supabase.from("chronicle").insert(slice);
    if (error) throw new Error(`insert chronicle: ${error.message}`);
    console.log(`  chronicle notes: ${Math.min(i + 100, noteRows.length)}/${noteRows.length}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
