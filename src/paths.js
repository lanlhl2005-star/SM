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

/**
 * Keep UNC roots intact. path.resolve() on non-Windows turns
 * \\Server\Share\... into a junk path under cwd.
 */
export function photoBackupRootPath() {
  const raw = String(config.photoBackupRoot || "");
  if (looksLikeUnc(raw)) {
    return path.normalize(raw);
  }
  return path.resolve(raw);
}

export function groupPhotoRoot(group) {
  const name = assertGroupName(group);
  const root = photoBackupRootPath();
  const full = looksLikeUnc(root)
    ? path.normalize(path.join(root, name))
    : path.resolve(root, name);
  const rootNorm = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  if (full !== rootNorm && !full.startsWith(rootNorm + path.sep)) {
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
  // UNC: \\server\share or //server/share (and JS strings that still have \\).
  return s.startsWith("\\\\") || s.startsWith("//");
}

/** Serialize fs failures for JSON APIs (UI shows code/errno). */
export function fsErrorPayload(err) {
  return {
    error: String(err?.message || err),
    code: err?.code || null,
    errno: err?.errno ?? null,
    path: err?.path || null,
  };
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

/**
 * SMB / UNC shares often return Dirent with unknown type so isDirectory()
 * is false even for real folders. Stat when the Dirent type is unreliable.
 */
function entryIsDirectory(parent, dirent) {
  if (dirent.name === "." || dirent.name === "..") return false;
  // Trust only a positive isDirectory(). On SMB/UNC, Dirent type is often
  // unknown (all is*() false); junctions may look like symlinks — always stat.
  try {
    if (dirent.isDirectory()) return true;
  } catch {
    // Some platform Dirent helpers throw; fall through to stat.
  }
  try {
    return fs.statSync(path.join(parent, dirent.name)).isDirectory();
  } catch {
    return false;
  }
}

function entryIsFile(parent, dirent) {
  try {
    if (dirent.isFile()) return true;
  } catch {
    // fall through
  }
  try {
    return fs.statSync(path.join(parent, dirent.name)).isFile();
  } catch {
    return false;
  }
}

function formatFsError(action, target, err) {
  const code = err?.code || err?.errno || "UNKNOWN";
  const errno = err?.errno != null ? ` errno=${err.errno}` : "";
  const msg = err?.message || String(err);
  const wrapped = new Error(`${action} failed for ${target}: ${msg} [${code}${errno}]`);
  wrapped.code = err?.code;
  wrapped.errno = err?.errno;
  wrapped.path = target;
  wrapped.cause = err;
  return wrapped;
}

function readDirents(dir, actionLabel) {
  try {
    fs.accessSync(dir, fs.constants.R_OK);
  } catch (err) {
    throw formatFsError(actionLabel, dir, err);
  }
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw formatFsError(actionLabel, dir, err);
  }
}

function compareGroupNames(a, b) {
  // Keep Archived discoverable but out of the way.
  if (a === "Archived" && b !== "Archived") return 1;
  if (b === "Archived" && a !== "Archived") return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Top-level folders under Group_photo_backup (real group subjects + individual). */
export function listPhotoGroups() {
  const root = photoBackupRootPath();
  const entries = readDirents(root, "listPhotoGroups");
  return entries
    .filter((d) => entryIsDirectory(root, d))
    .map((d) => d.name)
    .sort(compareGroupNames);
}

export function listDayFolders(group) {
  const root = groupPhotoRoot(group);
  const entries = readDirents(root, "listDayFolders");
  return entries
    .filter((d) => entryIsDirectory(root, d) && DAY_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

export function listPhotos(group, day) {
  if (!DAY_RE.test(day)) {
    throw new Error("Invalid day folder; expected YYYY-MM-DD");
  }
  const dir = path.join(groupPhotoRoot(group), day);
  let entries;
  try {
    entries = readDirents(dir, "listPhotos");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const groupName = assertGroupName(group);
  return entries
    .filter(
      (d) =>
        entryIsFile(dir, d) &&
        IMAGE_EXT.has(path.extname(d.name).toLowerCase())
    )
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
  const full = looksLikeUnc(root)
    ? path.normalize(path.join(root, ...parts))
    : path.resolve(root, cleaned);
  const rootNorm = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  if (full !== rootNorm && !full.startsWith(rootNorm + path.sep)) {
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
