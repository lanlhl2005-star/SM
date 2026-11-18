import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Safe copy policy:
 * - Same size already at destination → skip (dedupe / identical).
 * - Different content (size mismatch) → never overwrite; write name_2.ext, name_3.ext, …
 * - Missing destination → copy.
 */
export function uniqueDestPath(destDir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(destDir, fileName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${base}_${n}${ext}`);
    n += 1;
  }
  return candidate;
}

/**
 * @returns {{ action: "copied"|"skipped-same"|"skipped-unstable", dest?: string }}
 */
export function copyImageToBackup(sourcePath, group, dayFolder, sourceSize) {
  const destDir = path.join(config.photoBackupRoot, group, dayFolder);
  fs.mkdirSync(destDir, { recursive: true });

  const fileName = path.basename(sourcePath);
  let dest = path.join(destDir, fileName);

  if (fs.existsSync(dest)) {
    const destSize = fs.statSync(dest).size;
    if (destSize === sourceSize) {
      return { action: "skipped-same", dest };
    }
    dest = uniqueDestPath(destDir, fileName);
  }

  fs.copyFileSync(sourcePath, dest);
  return { action: "copied", dest };
}

export function dayFolderFromMtime(mtimeMs) {
  const d = new Date(mtimeMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
