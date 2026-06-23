import { File as NodeFile } from "node:buffer";
if (!globalThis.File) (globalThis as any).File = NodeFile;

import OpenAI, { toFile } from "openai";
import { OPENAI_API_KEY } from "./config.js";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer> {
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const info = (await infoRes.json()) as { ok: boolean; result: { file_path: string } };
  if (!info.ok) throw new Error("getFile failed");
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

export async function transcribeVoice(botToken: string, fileId: string): Promise<string | null> {
  try {
    const audio = await downloadTelegramFile(botToken, fileId);
    const file = await toFile(audio, "voice.ogg", { type: "audio/ogg" });
    const tr = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
    const text = tr.text?.trim() ?? "";
    return text.length ? text : null;
  } catch (err) {
    console.error("voice transcription failed:", err);
    return null;
  }
}

export { downloadTelegramFile };
