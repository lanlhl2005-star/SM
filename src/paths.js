import fs from "node:fs";
import path from "node:path";
import { config, siteMemoPhotoRoot } from "./config.js";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".tif",
  ".tiff",
]);

export function ensureRoots() {
  fs.mkdirSync(siteMemoPhotoRoot(), { recursive: true });
  fs.mkdirSync(config.siteMemoRoot, { recursive: true });
}

export function listDayFolders() {
  const root = siteMemoPhotoRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

export function listPhotos(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Invalid day folder; expected YYYY-MM-DD");
  }
  const dir = path.join(siteMemoPhotoRoot(), day);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
    .map((d) => {
      const full = path.join(dir, d.name);
      const st = fs.statSync(full);
      return {
        day,
        name: d.name,
        relativePath: path.join(day, d.name).replace(/\\/g, "/"),
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a photo relative path under site-memo backup; reject path escape. */
export function resolvePhotoPath(relativePath) {
  const root = path.resolve(siteMemoPhotoRoot());
  const cleaned = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const full = path.resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Photo path escapes backup root: ${relativePath}`);
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`Photo not found: ${relativePath}`);
  }
  if (!IMAGE_EXT.has(path.extname(full).toLowerCase())) {
    throw new Error(`Not an image file: ${relativePath}`);
  }
  return full;
}

export function sanitizeShortSubject(subject) {
  const raw = String(subject || "Site Memo")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = raw.slice(0, 48).trim() || "Site Memo";
  return clipped.replace(/[. ]+$/g, "") || "Site Memo";
}

export function draftFolderName(nn, shortSubject) {
  return `SM-${nn} ${shortSubject} (Draft)`;
}

export function memoFileName(seq3) {
  // Samples: Site_Memo_LK-P01043-SM-001.doc
  const code = config.projectCode.startsWith("LK-")
    ? config.projectCode
    : `${config.partyCode}-${config.projectCode}`;
  return `Site_Memo_${code}-SM-${seq3}.doc`;
}
