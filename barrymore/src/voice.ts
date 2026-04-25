import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Скачать голосовое сообщение от Telegram как Buffer
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

// Транскрибировать голосовое через Claude (поддерживает OGG/OPUS нативно)
export async function transcribeVoice(
  botToken: string,
  fileId: string
): Promise<string | null> {
  try {
    const audioBuffer = await downloadVoice(botToken, fileId);
    const base64Audio = audioBuffer.toString("base64");

    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type:       "base64",
                media_type: "audio/ogg" as "application/pdf", // type cast — API поддерживает audio
                data:       base64Audio,
              },
            } as Anthropic.DocumentBlockParam,
            {
              type: "text",
              text: "Transcribe this voice message verbatim. Return only the transcription text, nothing else. If you cannot process it, return empty string.",
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text");
    const transcript = text?.text?.trim() ?? "";
    return transcript.length > 0 ? transcript : null;
  } catch (err) {
    console.error("Voice transcription failed:", err);
    return null;
  }
}
