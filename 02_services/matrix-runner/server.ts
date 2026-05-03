/**
 * matrix-runner — webhook service that triggers the wine-purchase-matrix script.
 *
 * Apps Script in Google Sheets calls POST /run with `x-webhook-secret` header.
 * The matrix module is imported and runMatrix() is invoked in-process; console
 * output is captured and returned in the JSON response.
 *
 * Required env vars (Railway):
 *   WEBHOOK_SECRET, LOYVERSE_API_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *   GOOGLE_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, PORT (optional).
 */

import express from "express";
import { runMatrix } from "./matrix.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.WEBHOOK_SECRET;

app.get("/", (_req, res) => res.json({ ok: true, service: "matrix-runner" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Serialize concurrent runs — runMatrix mutates Sheets, no point running twice in parallel.
let running = false;

app.post("/run", async (req, res) => {
  if (!SECRET) return res.status(500).json({ error: "WEBHOOK_SECRET not configured" });
  const provided = req.header("x-webhook-secret") ?? req.body?.secret ?? "";
  if (provided !== SECRET) return res.status(401).json({ error: "bad secret" });
  if (running) return res.status(409).json({ error: "already running" });

  running = true;
  console.log(`[${new Date().toISOString()}] /run invoked from ${req.ip}`);
  const startedAt = Date.now();

  // Capture console output during the run.
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log   = (...args: any[]) => { const s = args.join(" "); lines.push(s); origLog(...args); };
  console.error = (...args: any[]) => { const s = args.join(" "); lines.push("[err] " + s); origErr(...args); };

  try {
    await runMatrix();
    const elapsedSec = Math.round((Date.now() - startedAt) / 100) / 10;
    const stdout = lines.join("\n");
    const summary = lines.filter(l =>
      /(Phase \d|Total:|Suppliers found|Period:|Белых:|Красных:|Игристых:|Крепких:)/.test(l),
    );
    res.json({ ok: true, elapsed_sec: elapsedSec, summary, stdout: stdout.slice(-4000) });
  } catch (err: any) {
    const elapsedSec = Math.round((Date.now() - startedAt) / 100) / 10;
    res.status(500).json({
      ok: false,
      elapsed_sec: elapsedSec,
      error: String(err?.message ?? err),
      stack: String(err?.stack ?? "").slice(0, 2000),
      stdout: lines.join("\n").slice(-4000),
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
    running = false;
  }
});

app.listen(PORT, () => {
  console.log(`matrix-runner listening on :${PORT}`);
});
