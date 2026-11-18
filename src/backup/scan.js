import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const IMAGE_EXT = new Set(
  (config.whatsappDesktop.imageExtensions || []).map((e) => e.toLowerCase())
);

export function isImageFile(filePath) {
  return IMAGE_EXT.has(path.extname(filePath).toLowerCase());
}

/**
 * Recursively list image files under root. Skips hidden / state junk.
 */
export function listImageFiles(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && isImageFile(full)) {
        out.push(full);
      }
    }
  }

  const st = fs.statSync(root);
  if (st.isFile()) {
    if (isImageFile(root)) out.push(root);
    return out;
  }
  walk(root);
  return out;
}

/** True when size has not changed for stableMs (file finished writing). */
export function isStableFile(filePath, stableMs) {
  let st1;
  try {
    st1 = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!st1.isFile() || st1.size <= 0) return false;

  // Fast path: mtime old enough
  const age = Date.now() - st1.mtimeMs;
  if (age >= stableMs) return true;

  // Otherwise re-check size after a short wait is caller's job; here treat young files as unstable
  return false;
}
