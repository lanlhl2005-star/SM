#!/usr/bin/env node
/**
 * Windows-friendly Draft UI auth diagnostic.
 * Prints .env path/encoding, resolved password length (never the secret),
 * and optionally probes a running server's public /api/auth-status.
 *
 * Usage:
 *   npm run check:auth
 *   node scripts/check-draft-ui-auth.mjs
 *   node scripts/check-draft-ui-auth.mjs --url http://127.0.0.1:3847
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnvFile } from "../src/load-dotenv.js";
import { resolveDraftUiPassword } from "../src/draft-ui-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function detectEncoding(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return "utf16le-bom";
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return "utf16be-bom";
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return "utf8-bom";
  }
  // Heuristic: lots of NULs → likely UTF-16 without BOM
  let nuls = 0;
  const sample = Math.min(buf.length, 200);
  for (let i = 0; i < sample; i++) if (buf[i] === 0) nuls++;
  if (sample > 20 && nuls > sample / 4) return "utf16-likely";
  return "utf8";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

const envPath = path.join(ROOT, ".env");
console.log(`Repo root: ${ROOT}`);
console.log(`.env path: ${envPath}`);

if (!fs.existsSync(envPath)) {
  console.log(".env: MISSING");
  console.log("auth: would be OFF (no password file)");
  process.exitCode = 1;
} else {
  const buf = fs.readFileSync(envPath);
  const encoding = detectEncoding(buf);
  console.log(`.env size: ${buf.length} bytes`);
  console.log(`.env encoding guess: ${encoding}`);
  if (encoding !== "utf8" && encoding !== "utf8-bom") {
    console.warn(
      "WARNING: .env may be UTF-16. Re-save as UTF-8 in Notepad (Save As → UTF-8)."
    );
  }

  // Isolate from the current process env so we see what the file alone provides.
  /** @type {Record<string, string | undefined>} */
  const isolated = {};
  const loaded = loadDotEnvFile(ROOT, isolated);
  const fromFile = resolveDraftUiPassword(isolated);
  const withProcess = resolveDraftUiPassword({
    ...process.env,
    ...isolated,
  });

  console.log(`.env keys applied: ${Object.keys(loaded.applied).join(", ") || "(none)"}`);
  console.log(
    `password from .env alone: ${
      fromFile ? `SET (length ${fromFile.length})` : "EMPTY"
    }`
  );
  console.log(
    `password with process.env merge: ${
      withProcess ? `SET (length ${withProcess.length})` : "EMPTY"
    }`
  );
  if (!fromFile) {
    console.warn("auth would be OFF unless DRAFT_UI_PASSWORD is already in the shell.");
    process.exitCode = 1;
  } else {
    console.log("Expected after npm start: auth: ON + /login for unauthenticated visits.");
  }
}

const urlArgIdx = process.argv.indexOf("--url");
const base =
  urlArgIdx >= 0
    ? String(process.argv[urlArgIdx + 1] || "").replace(/\/$/, "")
    : `http://127.0.0.1:${process.env.PORT || 3847}`;

console.log("");
console.log(`Probing ${base}/api/auth-status …`);
try {
  const status = await fetchJson(`${base}/api/auth-status`);
  console.log(`  HTTP ${status.status}`);
  console.log(`  body: ${JSON.stringify(status.json)}`);
  if (!status.json || typeof status.json.authRequired !== "boolean") {
    console.warn("  Unexpected body — is an old server still bound to this port?");
    process.exitCode = 1;
  } else if (status.json.authRequired) {
    console.log("  Gate is ON. Unauthenticated GET / should 302 → /login.");
    const root = await fetchJson(`${base}/`);
    console.log(`  GET / → HTTP ${root.status} Location=${root.headers.location || "(none)"}`);
    if (root.status !== 302 || !String(root.headers.location || "").includes("/login")) {
      console.warn(
        "  FAIL: expected redirect to /login without a cookie. Stale process or wrong port?"
      );
      process.exitCode = 1;
    } else {
      console.log("  OK: unauthenticated visit forces /login.");
    }
  } else {
    console.warn("  Gate is OFF on the running server.");
    process.exitCode = 1;
  }
} catch (err) {
  console.warn(`  Probe failed: ${err.message || err}`);
  console.warn("  Start Draft UI with npm start, then re-run this check.");
}
