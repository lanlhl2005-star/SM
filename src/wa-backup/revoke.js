/**
 * Delete-for-everyone (revoke) → remove local Group_photo_backup files.
 *
 * Baileys emits `messages.update` with messageStubType REVOKE (1) after a
 * protocolMessage REVOKE. We map the revoked message key to paths stored in
 * `.wa-backup-state.json` and delete only files under PHOTO_BACKUP_ROOT.
 */
import fs from "node:fs";
import path from "node:path";
import { buildMsgKey } from "./media.js";
import { dayTagsIndexPath, tagsSidecarPath } from "./tags.js";

/** WAMessageStubType.REVOKE */
export const STUB_REVOKE = 1;
/** WAMessageStubType.ADMIN_REVOKE */
export const STUB_ADMIN_REVOKE = 132;
/** proto.Message.ProtocolMessage.Type.REVOKE */
export const PROTOCOL_REVOKE = 0;

/**
 * True when a Baileys messages.update payload is a revoke / delete-for-everyone.
 * @param {{ key?: object, update?: object }|null|undefined} item
 */
export function isRevokeUpdate(item) {
  const update = item?.update;
  if (!update || typeof update !== "object") return false;
  const stub = update.messageStubType;
  if (stub === STUB_REVOKE || stub === STUB_ADMIN_REVOKE) return true;
  if (stub === "REVOKE" || stub === "ADMIN_REVOKE") return true;
  return false;
}

/**
 * True when an upserted message is a protocolMessage REVOKE (raw, before
 * Baileys turns it into messages.update).
 * @param {object|null|undefined} msg
 */
export function isRevokeProtocolMessage(msg) {
  const proto =
    msg?.message?.protocolMessage ||
    msg?.message?.ephemeralMessage?.message?.protocolMessage;
  if (!proto || typeof proto !== "object") return false;
  const type = proto.type;
  return (
    type === PROTOCOL_REVOKE ||
    type === "REVOKE" ||
    type === 0
  );
}

/**
 * Target key of the message being revoked (original media message key fields).
 * Prefer protocolMessage.key when present; else messages.update key (Baileys
 * already swaps id to the original message id).
 *
 * @param {object} source messages.update item OR upserted protocol message
 * @returns {{ remoteJid: string, id: string, fromMe: boolean, participant: string }|null}
 */
export function extractRevokeTargetKey(source) {
  if (!source || typeof source !== "object") return null;

  const proto =
    source.message?.protocolMessage ||
    source.message?.ephemeralMessage?.message?.protocolMessage;
  if (proto?.key?.id) {
    const pk = proto.key;
    const outer = source.key || {};
    return {
      remoteJid: pk.remoteJid || outer.remoteJid || "",
      id: pk.id || "",
      fromMe: Boolean(pk.fromMe ?? outer.fromMe),
      participant: pk.participant || outer.participant || "",
    };
  }

  // messages.update: Baileys sets key.id = original id
  const key = source.key;
  if (key?.id) {
    return {
      remoteJid: key.remoteJid || "",
      id: key.id || "",
      fromMe: Boolean(key.fromMe),
      participant: key.participant || "",
    };
  }
  return null;
}

/**
 * Normalize dest / dests from a state entry into a unique list of absolute paths.
 * @param {object|null|undefined} entry
 * @returns {string[]}
 */
export function pathsForStateEntry(entry) {
  if (!entry || typeof entry !== "object") return [];
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (typeof p !== "string") return;
    const t = p.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (Array.isArray(entry.dests)) {
    for (const p of entry.dests) push(p);
  }
  push(entry.dest);
  return out;
}

/**
 * Resolve and verify candidate is strictly under photoBackupRoot.
 * Rejects path traversal and paths outside the backup tree.
 *
 * @param {string} candidate
 * @param {string} photoBackupRoot
 * @returns {string|null} resolved absolute path, or null if unsafe / outside root
 */
export function resolveSafeBackupPath(candidate, photoBackupRoot) {
  if (!candidate || !photoBackupRoot) return null;
  if (typeof candidate !== "string" || typeof photoBackupRoot !== "string") {
    return null;
  }
  const rootResolved = path.resolve(photoBackupRoot);
  const fileResolved = path.resolve(candidate);
  const rootWithSep = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  // Exact root itself is not a media file we should unlink.
  if (fileResolved === rootResolved) return null;
  const under =
    fileResolved.startsWith(rootWithSep) ||
    // Windows: compare case-insensitively
    (process.platform === "win32" &&
      fileResolved.toLowerCase().startsWith(rootWithSep.toLowerCase()));
  if (!under) return null;
  return fileResolved;
}

/**
 * Find state message keys that match a revoke target.
 * Exact buildMsgKey first; then fallback by remoteJid|id|fromMe (any participant)
 * so admin-revoke / participant JID drift still finds the saved entry.
 *
 * @param {object} state
 * @param {{ remoteJid: string, id: string, fromMe: boolean, participant: string }} targetKey
 * @returns {string[]} matching msgKey strings
 */
export function findStateKeysForRevoke(state, targetKey) {
  if (!state?.messages || !targetKey?.id) return [];
  const exact = buildMsgKey(targetKey);
  const hits = [];
  if (state.messages[exact]) hits.push(exact);

  const wantJid = targetKey.remoteJid || "";
  const wantId = targetKey.id || "";
  const wantFromMe = targetKey.fromMe ? "1" : "0";
  const prefix = `${wantJid}|${wantId}|${wantFromMe}|`;

  for (const k of Object.keys(state.messages)) {
    if (k === exact) continue;
    if (k.startsWith(prefix)) hits.push(k);
  }
  return hits;
}

/**
 * Remove one media file's entry from the day-folder tags.json index.
 * @param {string} mediaPath
 */
export function removeFromDayTagsIndex(mediaPath) {
  const indexPath = dayTagsIndexPath(path.dirname(mediaPath));
  if (!fs.existsSync(indexPath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (!raw?.files || typeof raw.files !== "object") return;
    const name = path.basename(mediaPath);
    if (!(name in raw.files)) return;
    delete raw.files[name];
    fs.writeFileSync(indexPath, JSON.stringify(raw, null, 2), "utf8");
  } catch {
    /* best-effort index cleanup */
  }
}

/**
 * Safely delete backup media paths (and tag sidecars / index entries).
 * Only deletes paths that resolve under photoBackupRoot.
 *
 * @returns {{ deleted: string[], skipped: string[], errors: Array<{ path: string, error: string }> }}
 */
export function deleteBackupPaths({
  paths = [],
  photoBackupRoot,
  unlinkFn = fs.unlinkSync,
  existsFn = fs.existsSync,
} = {}) {
  const deleted = [];
  const skipped = [];
  const errors = [];

  for (const raw of paths) {
    const safe = resolveSafeBackupPath(raw, photoBackupRoot);
    if (!safe) {
      skipped.push(raw);
      continue;
    }
    try {
      if (existsFn(safe)) {
        unlinkFn(safe);
        deleted.push(safe);
      } else {
        // Already gone — treat as success for revoke bookkeeping
        deleted.push(safe);
      }
    } catch (err) {
      errors.push({ path: safe, error: err?.message || String(err) });
      continue;
    }

    const sidecar = tagsSidecarPath(safe);
    try {
      if (existsFn(sidecar)) unlinkFn(sidecar);
    } catch {
      /* ignore sidecar errors */
    }
    try {
      removeFromDayTagsIndex(safe);
    } catch {
      /* ignore */
    }
  }

  return { deleted, skipped, errors };
}

/**
 * Apply revoke: look up state paths, delete under root, mark entries revoked.
 *
 * @returns {{ matchedKeys: string[], deleted: string[], skipped: string[], errors: Array, noMapping: boolean }}
 */
export function revokeAndDeleteBackup({
  state,
  targetKey,
  photoBackupRoot,
  unlinkFn,
  existsFn,
} = {}) {
  const matchedKeys = findStateKeysForRevoke(state, targetKey);
  if (!matchedKeys.length) {
    return {
      matchedKeys: [],
      deleted: [],
      skipped: [],
      errors: [],
      noMapping: true,
    };
  }

  const allPaths = [];
  for (const k of matchedKeys) {
    allPaths.push(...pathsForStateEntry(state.messages[k]));
  }

  const result = deleteBackupPaths({
    paths: allPaths,
    photoBackupRoot,
    unlinkFn,
    existsFn,
  });

  const now = new Date().toISOString();
  for (const k of matchedKeys) {
    const prev = state.messages[k] || {};
    state.messages[k] = {
      ...prev,
      status: "revoked",
      dests: pathsForStateEntry(prev),
      revokedAt: now,
      updatedAt: now,
    };
  }

  return {
    matchedKeys,
    deleted: result.deleted,
    skipped: result.skipped,
    errors: result.errors,
    noMapping: false,
  };
}
