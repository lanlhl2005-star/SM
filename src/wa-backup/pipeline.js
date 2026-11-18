import fs from "node:fs";
import path from "node:path";
import {
  buildMsgKey,
  classifyMessage,
  extractCaption,
  jidIsGroup,
  messageTs,
  shouldSaveMediaKind,
} from "./media.js";
import { mapSubjectToGroup } from "./group-map.js";
import {
  dayFolderFromTs,
  extensionFromMeta,
  nextAvailableFileName,
  resolveFileStem,
} from "./naming.js";
import { downloadToFile } from "./session.js";
import { moveFile } from "./move-file.js";
import { createDownloadQueue } from "./download-queue.js";
import { getProcessed, markProcessed, saveState } from "./state.js";
import { touchHeartbeat } from "./heartbeat.js";

/**
 * Incoming media → PHOTO_BACKUP_ROOT\<group>\YYYY-MM-DD\<file>
 * Incoming only; never sends. Patterns adapted from whatsapp-media-saver.
 */
export function createPipeline({
  baileysCfg,
  photoBackupRoot,
  state,
  stateFile,
  sock,
  logger,
  tmpDir,
}) {
  const queue = createDownloadQueue({
    concurrency: baileysCfg.maxConcurrentDownloads || 2,
    logger,
  });

  /** @type {Map<string, string>} chatJid -> group subject */
  const groupNames = new Map();
  let dirty = false;
  let saveTimer = null;

  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!dirty) return;
      dirty = false;
      try {
        saveState(stateFile, state);
      } catch (err) {
        logger.warn({ err: err.message }, "state save failed");
      }
    }, 750);
  }

  async function refreshGroupName(jid) {
    if (!jidIsGroup(jid)) return null;
    if (groupNames.has(jid)) return groupNames.get(jid);
    try {
      const meta = await sock.groupMetadata(jid);
      const subject = meta?.subject || jid;
      groupNames.set(jid, subject);
      return subject;
    } catch (err) {
      logger.warn({ jid, err: err.message }, "Could not fetch group metadata");
      const fallback = `group_${String(jid).split("@")[0]}`;
      groupNames.set(jid, fallback);
      return fallback;
    }
  }

  function ensureDestDir(group, day) {
    const destDir = path.join(photoBackupRoot, group, day);
    fs.mkdirSync(destDir, { recursive: true });
    return destDir;
  }

  async function handleIncomingMedia(msg) {
    const key = msg.key || {};
    if (key.fromMe) return; // incoming only — never touch outbound
    if (!msg.message) return;

    const classified = classifyMessage(msg.message);
    if (!shouldSaveMediaKind(classified.kind, baileysCfg.mediaTypes)) {
      return;
    }

    const msgKey = buildMsgKey(key);
    const existing = getProcessed(state, msgKey);
    if (existing?.status === "saved" || existing?.status === "skipped") {
      logger.debug({ msgKey }, "already processed — skip");
      return;
    }

    const chatId = key.remoteJid;
    const isGroup = jidIsGroup(chatId);
    const ts = messageTs(msg);
    const shortId = (key.id || "unknown").slice(-8);
    const originalFileName =
      classified.content?.fileName || classified.content?.filename || null;
    const caption = extractCaption(classified.content);
    const stem = resolveFileStem({ caption, originalFileName, shortMsgId: shortId });
    const ext = extensionFromMeta({
      mimetype: classified.content?.mimetype,
      fileName: originalFileName,
      mediaType: classified.kind,
    });

    let groupFolder = baileysCfg.fallbackGroup || "unmapped";
    let mapReason = "1:1 chat — using fallback group folder";
    if (isGroup) {
      const subject = await refreshGroupName(chatId);
      const mapped = mapSubjectToGroup(
        subject,
        baileysCfg.groupMap,
        baileysCfg.fallbackGroup || "unmapped"
      );
      groupFolder = mapped.group;
      mapReason = mapped.reason;
    }

    const day = dayFolderFromTs(ts, baileysCfg.timezone || "Asia/Hong_Kong");
    const destDir = ensureDestDir(groupFolder, day);
    const fileName = nextAvailableFileName(stem, ext, (n) =>
      fs.existsSync(path.join(destDir, n))
    );
    const absoluteFile = path.join(destDir, fileName);

    markProcessed(state, msgKey, {
      status: "pending",
      group: groupFolder,
      day,
      dest: absoluteFile,
    });
    scheduleSave();

    await queue.enqueue(async () => {
      const tmpName = `${Date.now()}_${shortId}${ext}`;
      const tmpPath = path.join(tmpDir, tmpName);
      try {
        await downloadToFile(sock, msg, tmpPath, logger);

        // Re-check collision at commit time
        let finalAbs = absoluteFile;
        if (fs.existsSync(finalAbs)) {
          const name = nextAvailableFileName(stem, ext, (n) =>
            fs.existsSync(path.join(destDir, n))
          );
          finalAbs = path.join(destDir, name);
        }
        // Local tmp → UNC share is cross-device; moveFile falls back to
        // copy-into-dest-.moving then rename within the share (avoids EXDEV).
        await moveFile(tmpPath, finalAbs);

        markProcessed(state, msgKey, {
          status: "saved",
          group: groupFolder,
          day,
          dest: finalAbs,
        });
        scheduleSave();

        logger.info(
          {
            file: path.join(groupFolder, day, path.basename(finalAbs)),
            type: classified.kind,
            mapReason,
          },
          "saved photo"
        );
      } catch (err) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        markProcessed(state, msgKey, {
          status: "failed",
          group: groupFolder,
          day,
          dest: absoluteFile,
          error: err?.message || String(err),
        });
        scheduleSave();
        logger.error({ err: err?.message, msgKey }, "download failed");
      }
    });
  }

  function onMessagesUpsert(upsert) {
    const messages = upsert?.messages || [];
    for (const msg of messages) {
      handleIncomingMedia(msg).catch((err) => {
        logger.error({ err: err?.message }, "handleIncomingMedia error");
      });
    }
  }

  function attach() {
    sock.ev.on("messages.upsert", onMessagesUpsert);
    sock.ev.on("groups.update", (updates) => {
      for (const u of updates || []) {
        if (u.id && u.subject) groupNames.set(u.id, u.subject);
      }
    });
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (dirty) {
      dirty = false;
      saveState(stateFile, state);
    }
  }

  function touch(extra = {}) {
    touchHeartbeat(baileysCfg.heartbeatPath, {
      mode: "run",
      queue: queue.size,
      ...extra,
    });
  }

  return {
    attach,
    flush,
    touch,
    queue,
    handleIncomingMedia,
  };
}
