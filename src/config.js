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

const useMock =
  truthy(process.env.USE_MOCK) ||
  (!process.env.PHOTO_BACKUP_ROOT && !process.env.SITE_MEMO_ROOT && !fs.existsSync(defaults.paths.siteMemoRoot));

const mockPhotoRoot = path.join(ROOT, "mock", "Group_photo_backup");
const mockSiteMemoRoot = path.join(ROOT, "mock", "Site Memo");

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
  letterhead: path.join(ROOT, "docs", "site-memo-assets", "lap-kei-letterhead.png"),
  fieldMap: path.join(ROOT, "docs", "site-memo-field-map.json"),
};

export function siteMemoPhotoRoot() {
  return path.join(config.photoBackupRoot, config.photoGroup);
}
