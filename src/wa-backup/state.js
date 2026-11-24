import fs from "node:fs";
import path from "node:path";

/**
 * Lightweight JSON dedupe store (avoids native better-sqlite3 on Windows PCs).
 * Keys = Baileys msg_key strings; values = {
 *   status: saved|pending|failed|skipped|revoked,
 *   dest?, dests? (absolute paths under PHOTO_BACKUP_ROOT),
 *   error?, updatedAt, revokedAt?
 * }.
 */
export function loadState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) return { version: 1, messages: {} };
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (!raw || typeof raw !== "object") return { version: 1, messages: {} };
    if (!raw.messages || typeof raw.messages !== "object") {
      return { version: 1, messages: {} };
    }
    return raw;
  } catch {
    return { version: 1, messages: {} };
  }
}

export function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

export function getProcessed(state, msgKey) {
  return state.messages?.[msgKey] || null;
}

export function markProcessed(state, msgKey, entry) {
  if (!state.messages) state.messages = {};
  state.messages[msgKey] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
}
