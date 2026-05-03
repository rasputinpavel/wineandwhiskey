/**
 * matrix-runner — tiny webhook service that triggers the wine-purchase-matrix script.
 *
 * Apps Script in Google Sheets calls POST /run with a shared secret in the
 * `x-webhook-secret` header. This service spawns the build_purchase_matrix.ts
 * script and returns its stdout/stderr.
 *
 * Required env vars (Railway):
 *   WEBHOOK_SECRET       — shared with Apps Script
 *   LOYVERSE_API_TOKEN   — for Loyverse data
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   PORT                 — (optional) defaults to 3000; Railway injects this.
 */

import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.WEBHOOK_SECRET;

// Resolve repo root (server.ts lives at <repo>/02_services/matrix-runner/server.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = "03_automation/build_purchase_matrix.ts";

app.get("/", (_req, res) => res.json({ ok: true, service: "matrix-runner" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/run", async (req, res) => {
  if (!SECRET) return res.status(500).json({ error: "WEBHOOK_SECRET not configured" });
  const provided = req.header("x-webhook-secret") ?? req.body?.secret ?? "";
  if (provided !== SECRET) return res.status(401).json({ error: "bad secret" });

  console.log(`[${new Date().toISOString()}] /run invoked from ${req.ip}`);
  const startedAt = Date.now();

  // Spawn script. Inherit env so all secrets propagate.
  const child = spawn("npx", ["tsx", SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", b => { stdout += b.toString(); });
  child.stderr.on("data", b => { stderr += b.toString(); });

  child.on("close", code => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 100) / 10;
    if (code === 0) {
      // Extract key summary lines from stdout for Apps Script to display.
      const summary: string[] = [];
      for (const line of stdout.split("\n")) {
        if (/(Phase \d|Total:|Suppliers found|Period:|Белых:|Красных:|Игристых:|Крепких:|Total:)/.test(line)) {
          summary.push(line.trim());
        }
      }
      res.json({ ok: true, code, elapsed_sec: elapsedSec, summary, stdout: stdout.slice(-4000) });
    } else {
      res.status(500).json({ ok: false, code, elapsed_sec: elapsedSec, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) });
    }
  });
});

app.listen(PORT, () => {
  console.log(`matrix-runner listening on :${PORT}`);
  console.log(`  repo root: ${REPO_ROOT}`);
  console.log(`  script:    ${SCRIPT_PATH}`);
});
