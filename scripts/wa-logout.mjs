#!/usr/bin/env node
/**
 * Clear Baileys linked-device auth so you can link a different WhatsApp number.
 *
 * Safe to run on Windows. Does NOT delete Group_photo_backup media.
 *
 * Usage (from repo root):
 *   npm run wa-logout
 *   npm run wa-logout -- --dry-run
 *   npm run wa-logout -- --clear-state
 *
 * Stop `npm run wa-backup` (Ctrl+C) before running this.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("-n");
const clearState = args.includes("--clear-state");

const b = config.whatsappBaileys;
const targets = [
  { label: "auth (session secrets)", path: b.authDir, kind: "dir" },
  { label: "download tmp", path: b.tmpDir, kind: "dir" },
  { label: "heartbeat", path: b.heartbeatPath, kind: "file" },
];
if (clearState) {
  targets.push({
    label: "dedupe state",
    path: b.stateFile,
    kind: "file",
  });
}

function rmPath(targetPath, kind) {
  if (!fs.existsSync(targetPath)) return false;
  if (dryRun) return true;
  if (kind === "dir") {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
  return true;
}

console.log(`Site Memo — clear WhatsApp Baileys auth (switch number)
  project: ${ROOT}
  dry-run: ${dryRun ? "yes" : "no"}
`);

console.log("Stop wa-backup first (Ctrl+C), then clear:");
let any = false;
for (const t of targets) {
  const exists = fs.existsSync(t.path);
  const rel = path.isAbsolute(t.path)
    ? path.relative(ROOT, t.path) || t.path
    : t.path;
  if (!exists) {
    console.log(`  skip  ${rel}  (${t.label} — not present)`);
    continue;
  }
  any = true;
  const did = rmPath(t.path, t.kind);
  console.log(`  ${dryRun ? "would remove" : "removed"}  ${rel}  (${t.label})`);
  if (!did && !dryRun) {
    console.error(`  failed: ${t.path}`);
    process.exit(1);
  }
}

if (!any) {
  console.log("  (nothing to clear — already logged out / never linked)");
}

console.log(`
Next:
  1. On the OLD phone: WhatsApp → Linked devices → remove this PC’s link (if still listed).
  2. On the NEW phone: free a Linked devices slot.
  3. If .env has WA_LINK_PHONE set for pairing-code link, update or comment it out for QR.
  4. npm run wa-link     (scan QR with the NEW phone; or: npm run wa-link -- --phone <digits>)
  5. npm run wa-backup

Group_photo_backup folders are kept. The new number must be in the same WhatsApp
groups for group photos/PDFs to arrive. Draft UI needs no restart for this switch.
`);
