import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reject path segments that could escape or nest unexpectedly. */
export function assertGroupName(group) {
  const name = String(group ?? "").trim();
  if (!name) throw new Error("Group folder is required");
  if (name === "." || name === "..") {
    throw new Error(`Invalid group folder: ${group}`);
  }
  if (/[/\\]/.test(name) || name.includes("\0")) {
    throw new Error(`Invalid group folder: ${group}`);
  }
  return name;
}

export function photoBackupRootPath() {
  return path.resolve(config.photoBackupRoot);
}

export function groupPhotoRoot(group) {
  const name = assertGroupName(group);
  const root = photoBackupRootPath();
  const full = path.resolve(root, name);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Group path escapes backup root: ${group}`);
  }
  return full;
}

/**
 * Optional PHOTO_GROUP default when that folder exists under the backup root.
 * Otherwise null (UI picks the first listed group).
 */
export function defaultPhotoGroup(groups = listPhotoGroups()) {
  const preferred = String(config.photoGroup || "").trim();
  if (preferred && groups.includes(preferred)) return preferred;
  return groups[0] || null;
}

function looksLikeUnc(p) {
  const s = String(p || "");
  return s.startsWith("\\\\") || s.startsWith("//");
}

export function ensureRoots() {
  // On non-Windows, Node treats \\Server\Share\... as a local relative path and
  // would mkdir junk under the repo. Skip creating live UNC roots off Windows.
  if (
    process.platform !== "win32" &&
    !config.useMock &&
    (looksLikeUnc(config.photoBackupRoot) || looksLikeUnc(config.siteMemoRoot))
  ) {
    return;
  }
  try {
    fs.mkdirSync(photoBackupRootPath(), { recursive: true });
    fs.mkdirSync(config.siteMemoRoot, { recursive: true });
  } catch (err) {
    if (config.useMock) throw err;
    console.warn(
      `ensureRoots: could not create live roots (${err.message}). ` +
        "Check the share is reachable, or set USE_MOCK=true for offline smoke."
    );
  }
}

/** Top-level folders under Group_photo_backup (real group subjects + individual). */
export function listPhotoGroups() {
  const root = photoBackupRootPath();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "." && d.name !== "..")
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function listDayFolders(group) {
  const root = groupPhotoRoot(group);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DAY_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

export function listPhotos(group, day) {
  if (!DAY_RE.test(day)) {
    throw new Error("Invalid day folder; expected YYYY-MM-DD");
  }
  const dir = path.join(groupPhotoRoot(group), day);
  if (!fs.existsSync(dir)) return [];
  const groupName = assertGroupName(group);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
    .map((d) => {
      const full = path.join(dir, d.name);
      const st = fs.statSync(full);
      return {
        group: groupName,
        day,
        name: d.name,
        relativePath: path.join(groupName, day, d.name).replace(/\\/g, "/"),
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a photo relative path under PHOTO_BACKUP_ROOT.
 * Expected form: <group>/<YYYY-MM-DD>/<file>
 */
export function resolvePhotoPath(relativePath) {
  const root = photoBackupRootPath();
  const cleaned = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 3) {
    throw new Error(
      `Photo path must be group/YYYY-MM-DD/file (got: ${relativePath})`
    );
  }
  const [group, day] = parts;
  assertGroupName(group);
  if (!DAY_RE.test(day)) {
    throw new Error(`Invalid day in photo path: ${relativePath}`);
  }
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

/** @deprecated Prefer groupPhotoRoot(group). Kept for older call sites. */
export function siteMemoPhotoRoot(group = config.photoGroup) {
  if (group) return groupPhotoRoot(group);
  return photoBackupRootPath();
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
