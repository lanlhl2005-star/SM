import fs from "node:fs";
import { config } from "../config.js";

function emptyState() {
  return { version: 1, files: {} };
}

export function loadState() {
  const file = config.whatsappDesktop.stateFile;
  try {
    if (!fs.existsSync(file)) return emptyState();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || typeof raw.files !== "object") {
      return emptyState();
    }
    return { version: 1, files: raw.files };
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  const file = config.whatsappDesktop.stateFile;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** Fingerprint used to skip already-copied sources. */
export function sourceKey(absPath, size, mtimeMs) {
  return `${absPath}|${size}|${mtimeMs}`;
}

export function wasCopied(state, key) {
  return Boolean(state.files[key]);
}

export function markCopied(state, key, destPath) {
  state.files[key] = {
    dest: destPath,
    at: new Date().toISOString(),
  };
}
