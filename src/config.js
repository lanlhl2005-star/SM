import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
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

const useMock =
  truthy(process.env.USE_MOCK) ||
  (!process.env.PHOTO_BACKUP_ROOT &&
    !process.env.SITE_MEMO_ROOT &&
    !fs.existsSync(defaults.paths.siteMemoRoot));

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

export const config = {
  root: ROOT,
  useMock,
  projectCode: defaults.projectCode,
  partyCode: defaults.partyCode,
  photoGroup: process.env.PHOTO_GROUP || defaults.photoGroup,
  photoBackupRoot: process.env.PHOTO_BACKUP_ROOT
    ? process.env.PHOTO_BACKUP_ROOT
    : useMock
      ? mockPhotoRoot
      : defaults.paths.photoBackupRoot,
  siteMemoRoot: process.env.SITE_MEMO_ROOT
    ? process.env.SITE_MEMO_ROOT
    : useMock
      ? mockSiteMemoRoot
      : defaults.paths.siteMemoRoot,
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
    fallbackGroup:
      process.env.WA_FALLBACK_GROUP ||
      baileysDefaults.fallbackGroup ||
      waDefaults.fallbackGroup ||
      "unmapped",
    // Prefer Baileys groupMap; fall back to Desktop aliases so one edit covers both.
    groupMap: baileysDefaults.groupMap || waDefaults.groupMap || {},
  },
};

export function siteMemoPhotoRoot() {
  return path.join(config.photoBackupRoot, config.photoGroup);
}
