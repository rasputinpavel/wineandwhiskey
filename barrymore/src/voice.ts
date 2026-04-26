import { File as NodeFile } from "node:buffer";
if (!globalThis.File) (globalThis as any).File = NodeFile;

import OpenAI, { toFile } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function downloadVoice(botToken: string, fileId: string): Promise<Buffer> {
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const info = await infoRes.json() as { ok: boolean; result: { file_path: string } };
  if (!info.ok) throw new Error("Не удалось получить информацию о файле");

  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`
  );
  return Buffer.from(await fileRes.arrayBuffer());
}

export async function transcribeVoice(
  botToken: string,
  fileId: string
): Promise<string | null> {
  try {
    const audioBuffer = await downloadVoice(botToken, fileId);
    const file = await toFile(audioBuffer, "voice.ogg", { type: "audio/ogg" });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model:    "whisper-1",
      language: "ru",
    });

    const text = transcription.text?.trim() ?? "";
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error("Voice transcription failed:", err);
    return null;
  }
}
