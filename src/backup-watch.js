#!/usr/bin/env node
/**
 * WhatsApp Desktop media → Group_photo_backup watcher.
 *
 * OPTIONAL / DEPRECATED fallback. Prefer Baileys linked-device backup:
 *   npm run wa-link && npm run wa-backup
 * See docs/whatsapp-baileys-backup.md
 *
 * Watches the Desktop media cache (or mock/), copies new images into
 * PHOTO_BACKUP_ROOT\<group>\YYYY-MM-DD\. No WhatsApp send.
 *
 * Usage:
 *   npm run backup-watch
 *   npm run backup-watch -- --once
 *   npm run backup-watch -- --help
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { copyImageToBackup, dayFolderFromMtime } from "./backup/copy.js";
import { mapSourceToGroup, listKnownGroups } from "./backup/group-map.js";
import { listImageFiles, isStableFile } from "./backup/scan.js";
import {
  loadState,
  saveState,
  sourceKey,
  wasCopied,
  markCopied,
} from "./backup/state.js";

function parseArgs(argv) {
  const opts = { once: false, help: false };
  for (const a of argv) {
    if (a === "--once") opts.once = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`WhatsApp Desktop photo backup watcher (OPTIONAL / DEPRECATED)

Prefer: npm run wa-link && npm run wa-backup
  (Baileys linked device — see docs/whatsapp-baileys-backup.md)

Copies new images from the Desktop media cache into:
  <PHOTO_BACKUP_ROOT>\\<group>\\YYYY-MM-DD\\

Known groups: ${listKnownGroups().join(", ") || "(none)"}
Fallback group: ${config.whatsappDesktop.fallbackGroup}

Flags:
  --once    Scan once and exit (good for smoke / Task Scheduler dry-run)
  --help    Show this help

Env (see .env.example):
  USE_MOCK=true                 Use mock/WhatsAppDesktop/media + mock/Group_photo_backup
  WA_DESKTOP_MEDIA_ROOT=...     Override Desktop media path
  PHOTO_BACKUP_ROOT=...         Same share root as the Draft UI
  WA_WATCH_POLL_MS=5000         Poll interval
  WA_FALLBACK_GROUP=unmapped    When group cannot be inferred
`);
}

function ensureBackupRoots() {
  fs.mkdirSync(config.photoBackupRoot, { recursive: true });
  for (const g of [...listKnownGroups(), config.whatsappDesktop.fallbackGroup]) {
    fs.mkdirSync(path.join(config.photoBackupRoot, g), { recursive: true });
  }
}

/**
 * @returns {{ copied: number, skipped: number, unstable: number, errors: number }}
 */
function scanOnce(state) {
  const mediaRoot = config.whatsappDesktop.mediaRoot;
  const stats = { copied: 0, skipped: 0, unstable: 0, errors: 0 };
  let dirty = false;

  if (!mediaRoot || !fs.existsSync(mediaRoot)) {
    console.warn(`[watch] media root missing: ${mediaRoot || "(empty)"}`);
    return stats;
  }

  const files = listImageFiles(mediaRoot);
  for (const src of files) {
    try {
      if (!isStableFile(src, config.whatsappDesktop.stableMs)) {
        stats.unstable += 1;
        continue;
      }
      const st = fs.statSync(src);
      const key = sourceKey(src, st.size, st.mtimeMs);
      if (wasCopied(state, key)) {
        stats.skipped += 1;
        continue;
      }

      const { group, reason } = mapSourceToGroup(src, mediaRoot);
      const day = dayFolderFromMtime(st.mtimeMs);
      const result = copyImageToBackup(src, group, day, st.size);

      if (result.action === "copied") {
        console.log(`[copy] ${path.basename(src)} → ${group}/${day}/  (${reason})`);
        console.log(`       ${result.dest}`);
        stats.copied += 1;
      } else if (result.action === "skipped-same") {
        console.log(`[skip] identical already at ${result.dest}`);
        stats.skipped += 1;
      }

      markCopied(state, key, result.dest);
      dirty = true;
    } catch (err) {
      stats.errors += 1;
      console.error(`[error] ${src}: ${err.message || err}`);
    }
  }

  if (dirty) saveState(state);
  return stats;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  ensureBackupRoots();
  const state = loadState();

  console.log("WhatsApp Desktop → Group_photo_backup watcher");
  console.log(`  USE_MOCK=${config.useMock}`);
  console.log(`  media:  ${config.whatsappDesktop.mediaRoot}`);
  console.log(`  backup: ${config.photoBackupRoot}`);
  console.log(`  groups: ${listKnownGroups().join(", ")}`);
  console.log(`  fallback: ${config.whatsappDesktop.fallbackGroup}`);
  console.log(`  state:  ${config.whatsappDesktop.stateFile}`);
  console.log("  (no WhatsApp send — backup copy only)");

  const run = () => {
    const s = scanOnce(state);
    console.log(
      `[scan] copied=${s.copied} skipped=${s.skipped} unstable=${s.unstable} errors=${s.errors}`
    );
    return s;
  };

  if (opts.once) {
    const s = run();
    process.exit(s.errors > 0 ? 1 : 0);
  }

  run();
  const interval = Math.max(1000, config.whatsappDesktop.pollIntervalMs);
  console.log(`[watch] polling every ${interval}ms (Ctrl+C to stop)`);

  // Optional fs.watch for quicker reaction; poll remains source of truth on Windows.
  try {
    if (fs.existsSync(config.whatsappDesktop.mediaRoot)) {
      fs.watch(
        config.whatsappDesktop.mediaRoot,
        { recursive: true },
        () => {
          // debounce via next poll; mark nothing — poll handles stability
        }
      );
    }
  } catch (err) {
    console.warn(`[watch] fs.watch unavailable (${err.message}); poll-only mode`);
  }

  setInterval(run, interval);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
