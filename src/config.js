import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowUncHostsForPaths } from "./unc-allowlist.js";
import { preferMappedDrivePath } from "./unc-mapped-drive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const dotenvPath = path.join(ROOT, ".env");
  if (!fs.existsSync(dotenvPath)) return;
  const text = fs.readFileSync(dotenvPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const defaults = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config", "default.json"), "utf8")
);

function truthy(v) {
  if (v === undefined || v === null || v === "") return false;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function expandWindowsEnv(input) {
  if (!input) return input;
  return String(input).replace(/%([^%]+)%/g, (_, name) => {
    const v = process.env[name];
    return v !== undefined ? v : `%${name}%`;
  });
}

const envPath = path.join(ROOT, ".env");
export const envFileExists = fs.existsSync(envPath);

// Mock ONLY when USE_MOCK is explicitly truthy. Unset / false → live UNC from
// config/default.json (or PHOTO_* / SITE_* env overrides). No auto-fallback when
// the share is invisible from this machine (cloud agents must set USE_MOCK=true).
const useMock = truthy(process.env.USE_MOCK);

const mockPhotoRoot = path.join(ROOT, "mock", "Group_photo_backup");
const mockSiteMemoRoot = path.join(ROOT, "mock", "Site Memo");
const mockWaDesktopRoot = path.join(ROOT, "mock", "WhatsAppDesktop", "media");

const waDefaults = defaults.whatsappDesktop || {};
const baileysDefaults = defaults.whatsappBaileys || {};

function resolveWaDesktopMediaRoot() {
  if (process.env.WA_DESKTOP_MEDIA_ROOT) {
    return expandWindowsEnv(process.env.WA_DESKTOP_MEDIA_ROOT);
  }
  if (useMock) return mockWaDesktopRoot;
  return expandWindowsEnv(waDefaults.mediaRootHint || "");
}

function resolveMaybeRelative(p, fallback) {
  const value = p || fallback;
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const photoBackupRootRaw = process.env.PHOTO_BACKUP_ROOT
  ? process.env.PHOTO_BACKUP_ROOT
  : useMock
    ? mockPhotoRoot
    : defaults.paths.photoBackupRoot;
const siteMemoRootRaw = process.env.SITE_MEMO_ROOT
  ? process.env.SITE_MEMO_ROOT
  : useMock
    ? mockSiteMemoRoot
    : defaults.paths.siteMemoRoot;

// Prefer mapped drive letters over UNC. Official nodejs.org builds do NOT
// implement NODE_UNC_HOST_ALLOWLIST; drive letters work on every Node build.
const photoMapped = preferMappedDrivePath(photoBackupRootRaw);
const siteMapped = preferMappedDrivePath(siteMemoRootRaw);
const photoBackupRoot = photoMapped.path;
const siteMemoRoot = siteMapped.path;

/** @type {string[]} */
export const uncPathRewrites = [];
if (photoMapped.mapped && photoMapped.path !== photoBackupRootRaw) {
  uncPathRewrites.push(`photos: ${photoBackupRootRaw} → ${photoMapped.path}`);
}
if (siteMapped.mapped && siteMapped.path !== siteMemoRootRaw) {
  uncPathRewrites.push(`site memos: ${siteMemoRootRaw} → ${siteMapped.path}`);
}
export const uncMapSuggestion =
  (!photoMapped.mapped && photoMapped.suggestion) ||
  (!siteMapped.mapped && siteMapped.suggestion) ||
  null;

// Also prime Electron/Cursor UNC allowlist when that API exists (no-op on stock Node).
allowUncHostsForPaths([photoBackupRootRaw, siteMemoRootRaw, photoBackupRoot, siteMemoRoot]);

export const config = {
  root: ROOT,
  useMock,
  projectCode: defaults.projectCode,
  partyCode: defaults.partyCode,
  // Optional default group selection for Draft UI (must match a top-level folder).
  photoGroup: String(
    process.env.PHOTO_GROUP !== undefined
      ? process.env.PHOTO_GROUP
      : defaults.photoGroup ?? ""
  ).trim(),
  photoBackupRoot,
  siteMemoRoot,
  projectLocked: defaults.projectLocked,
  host: process.env.HOST || defaults.server.host,
  port: Number(process.env.PORT || defaults.server.port),
  templateDoc: path.join(ROOT, "docs", "site-memo-template.doc"),
  letterhead: path.join(
    ROOT,
    "docs",
    "site-memo-assets",
    "lap-kei-letterhead.png"
  ),
  fieldMap: path.join(ROOT, "docs", "site-memo-field-map.json"),
  whatsappDesktop: {
    deprecated: waDefaults.deprecated !== false,
    mediaRoot: resolveWaDesktopMediaRoot(),
    mediaRootHint: waDefaults.mediaRootHint,
    pollIntervalMs: Number(
      process.env.WA_WATCH_POLL_MS || waDefaults.pollIntervalMs || 5000
    ),
    stableMs: Number(process.env.WA_WATCH_STABLE_MS || waDefaults.stableMs || 1500),
    fallbackGroup: process.env.WA_FALLBACK_GROUP || waDefaults.fallbackGroup || "unmapped",
    imageExtensions: waDefaults.imageExtensions || [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".webp",
      ".tif",
      ".tiff",
    ],
    groupMap: waDefaults.groupMap || {},
    stateFile: process.env.WA_WATCH_STATE_FILE
      ? expandWindowsEnv(process.env.WA_WATCH_STATE_FILE)
      : path.join(ROOT, ".backup-watch-state.json"),
  },
  whatsappBaileys: {
    authDir: resolveMaybeRelative(
      process.env.WA_AUTH_DIR || baileysDefaults.authDir,
      ".wa-auth"
    ),
    stateFile: resolveMaybeRelative(
      process.env.WA_BACKUP_STATE_FILE || baileysDefaults.stateFile,
      ".wa-backup-state.json"
    ),
    heartbeatPath: resolveMaybeRelative(
      process.env.WA_BACKUP_HEARTBEAT || baileysDefaults.heartbeatPath,
      ".wa-backup-heartbeat.json"
    ),
    tmpDir: resolveMaybeRelative(
      process.env.WA_BACKUP_TMP || baileysDefaults.tmpDir,
      ".wa-backup-tmp"
    ),
    timezone: process.env.WA_BACKUP_TZ || baileysDefaults.timezone || "Asia/Hong_Kong",
    mediaTypes: baileysDefaults.mediaTypes || ["image"],
    maxConcurrentDownloads: Number(
      process.env.WA_BACKUP_CONCURRENCY ||
        baileysDefaults.maxConcurrentDownloads ||
        2
    ),
    heartbeatStaleMs: Number(
      process.env.WA_BACKUP_HEARTBEAT_STALE_MS ||
        baileysDefaults.heartbeatStaleMs ||
        120000
    ),
    // Live WhatsApp group subject → folder; 1:1 chats use this name.
    individualFolder:
      process.env.WA_INDIVIDUAL_FOLDER ||
      baileysDefaults.individualFolder ||
      "individual",
  },
};

/** @deprecated Prefer listing groups under photoBackupRoot. */
export function siteMemoPhotoRoot(group = config.photoGroup) {
  if (group) return path.join(config.photoBackupRoot, group);
  return config.photoBackupRoot;
}
