import Anthropic from "@anthropic-ai/sdk";
import { supabase, PO_BUCKET } from "./db.js";
import { parsePOJSON, toISODate, type POExtraction } from "./po-parse.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PO_PROMPT =
  `Перед тобой документ, пришедший с поставкой в винный магазин. ` +
  `Определи, это purchase order / инвойс / счёт от ПОСТАВЩИКА ` +
  `(а НЕ кассовый чек об оплате и НЕ квитанция расхода магазина). ` +
  `Если это документ поставщика — извлеки поля. ` +
  `supplier — КРАТКОЕ торговое название компании на латинице/английском (например "Italasia Trading" или "Harvest"); ` +
  `НЕ включай тайское написание, юридическую форму («Co., Ltd.», «บริษัท … จำกัด»), скобки, адрес и прочий текст; ` +
  `если на документе есть только тайское название — дай его латинское написание. ` +
  `doc_number — номер документа (PO / invoice №). order_date — дата документа (DD.MM.YYYY). ` +
  `amount — итоговая сумма в THB (только число). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и пояснений. Пример документа поставщика: ` +
  `{"is_po": true, "supplier": "Italasia Trading", "doc_number": "IV0326080074", "order_date": "03.08.2026", "amount": "7049.16"}. ` +
  `Если это НЕ документ поставщика: {"is_po": false}.`;

// Ask Claude vision whether the photo/document is a supplier PO and extract its
// fields. Returns null when it is not a PO (→ caller falls back to expenses).
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

function extOf(mime: string): string {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
}

// Upload the scan the moment the card is shown, so the bytes are safely
// persisted before the user confirms. The confirm step then only needs the
// object path, which rides in the callback data and survives a bot restart.
export async function uploadScan(
  base64: string,
  mime: "image/jpeg" | "image/png" | "application/pdf",
): Promise<string> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const path = `scans/${token}.${extOf(mime)}`;
  const buffer = Buffer.from(base64, "base64");
  const up = await supabase.storage.from(PO_BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
  return path;
}

// Best-effort delete of a scan object (cancel, or "это расход").
export async function deleteScan(path: string): Promise<void> {
  if (!supabase || !path) return;
  try {
    await supabase.storage.from(PO_BUCKET).remove([path]);
  } catch (e) {
    console.error("po_scans deleteScan failed:", e);
  }
}

// Fetch a scan's bytes back — used by the "это расход" fallback, which needs the
// image to hand to the expense flow. Returns null on any failure.
export async function downloadScan(
  path: string,
): Promise<{ base64: string; mime: "image/jpeg" | "image/png" | "application/pdf" } | null> {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from(PO_BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".png") ? "image/png" : "image/jpeg";
  return { base64: buf.toString("base64"), mime: mime as "image/jpeg" | "image/png" | "application/pdf" };
}

export type POFields = {
  supplier: string;
  docNumber: string;
  orderDate: string;    // DD.MM.YYYY or ""
  receivedDate: string; // DD.MM.YYYY
  amount: string;       // digits only, or ""
  uploadedBy: string;
};

// Write the row for an already-uploaded scan. Insert, or (overwrite) update the
// existing row with the same doc_number — preserving the portal-entered note —
// then drop the stale scan file(s).
export async function commitPO(
  f: POFields,
  scanPath: string,
  opts?: { overwrite?: boolean },
): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");
  const db = supabase;

  const record = {
    supplier: f.supplier || null,
    supplier_raw: f.supplier || null,
    doc_number: f.docNumber || null,
    order_date: toISODate(f.orderDate),
    received_date: toISODate(f.receivedDate),
    amount_total: f.amount ? Number(f.amount) : null,
    scan_path: scanPath,
    note: null as string | null,
    uploaded_by: f.uploadedBy || null,
  };

  const removeQuietly = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      await db.storage.from(PO_BUCKET).remove(paths);
    } catch (e) {
      console.error("po_scans scan cleanup failed:", e);
    }
  };

  if (opts?.overwrite && f.docNumber) {
    const { data: existing } = await db
      .from("po_scans")
      .select("scan_path")
      .eq("doc_number", f.docNumber);

    // Preserve the human-entered note on overwrite (edited on the portal).
    const { note: _note, ...updateFields } = record;
    const upd = await db.from("po_scans").update(updateFields).eq("doc_number", f.docNumber);
    if (upd.error) {
      await removeQuietly([scanPath]);
      throw new Error(`DB update failed: ${upd.error.message}`);
    }
    const stale = (existing ?? [])
      .map((r: { scan_path: string | null }) => r.scan_path)
      .filter((s): s is string => !!s && s !== scanPath);
    await removeQuietly(stale);
    return;
  }

  const ins = await db.from("po_scans").insert(record);
  if (ins.error) {
    await removeQuietly([scanPath]);
    throw new Error(`DB insert failed: ${ins.error.message}`);
  }
}
