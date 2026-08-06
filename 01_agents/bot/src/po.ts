import Anthropic from "@anthropic-ai/sdk";
import { supabase, PO_BUCKET } from "./db.js";
import { parsePOJSON, toISODate, type POExtraction, type PendingPO } from "./po-parse.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PO_PROMPT =
  `Перед тобой документ, пришедший с поставкой в винный магазин. ` +
  `Определи, это purchase order / инвойс / счёт от ПОСТАВЩИКА ` +
  `(а НЕ кассовый чек об оплате и НЕ квитанция расхода магазина). ` +
  `Если это документ поставщика — извлеки поля: название поставщика, номер документа (PO/invoice №), ` +
  `дату документа (DD.MM.YYYY) и итоговую сумму в THB (только число). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и пояснений. Пример документа поставщика: ` +
  `{"is_po": true, "supplier": "Harvest", "doc_number": "INV-8842", "order_date": "05.08.2026", "amount": "24500"}. ` +
  `Если это НЕ документ поставщика: {"is_po": false}.`;

// Ask Claude vision whether the photo is a supplier PO and extract its fields.
// Returns null when it is not a PO (→ caller falls back to the expense flow).
export async function classifyAndExtractPO(
  base64: string,
  mime: "image/jpeg" | "image/png" | "application/pdf",
): Promise<POExtraction | null> {
  // PDFs go in a `document` block (Claude reads them natively); images in an
  // `image` block. The SDK types for these unions vary by version, so the block
  // is built loosely and passed through.
  const source = { type: "base64" as const, media_type: mime, data: base64 };
  const fileBlock: any =
    mime === "application/pdf"
      ? { type: "document", source }
      : { type: "image", source };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: PO_PROMPT }],
      },
    ],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parsePOJSON(raw);
}

// Soft duplicate check — same doc_number already archived?
export async function isDuplicateDocNumber(docNumber: string): Promise<boolean> {
  if (!supabase || !docNumber) return false;
  const { data } = await supabase
    .from("po_scans")
    .select("id")
    .eq("doc_number", docNumber)
    .limit(1);
  return !!(data && data.length > 0);
}

// Upload the scan to the private bucket, then insert the row. If the DB insert
// fails, the just-uploaded object is removed so we don't orphan it.
export async function savePO(p: PendingPO): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");

  const ext =
    p.scanMime === "application/pdf" ? "pdf" :
    p.scanMime === "image/png"       ? "png" : "jpg";
  const safeSupplier =
    (p.supplier || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "unknown";
  const safeDoc = (p.docNumber || "no-number").replace(/[^A-Za-z0-9._-]+/g, "-");
  const path = `${safeSupplier}/${safeDoc}_${Date.now()}.${ext}`;
  const buffer = Buffer.from(p.scanBase64, "base64");

  const up = await supabase.storage
    .from(PO_BUCKET)
    .upload(path, buffer, { contentType: p.scanMime, upsert: false });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

  const ins = await supabase.from("po_scans").insert({
    supplier: p.supplier || null,
    supplier_raw: p.supplier || null,
    doc_number: p.docNumber || null,
    order_date: toISODate(p.orderDate),
    received_date: toISODate(p.receivedDate),
    amount_total: p.amount ? Number(p.amount) : null,
    scan_path: path,
    note: p.note || null,
    uploaded_by: p.uploadedBy || null,
  });
  if (ins.error) {
    // Best-effort cleanup of the just-uploaded object; never let a failed remove
    // mask the real insert error.
    try {
      await supabase.storage.from(PO_BUCKET).remove([path]);
    } catch (removeErr) {
      console.error("po_scans rollback remove failed:", removeErr);
    }
    throw new Error(`DB insert failed: ${ins.error.message}`);
  }
}
