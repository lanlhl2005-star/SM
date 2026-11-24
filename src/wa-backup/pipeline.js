import fs from "node:fs";
import path from "node:path";
import {
  buildMsgKey,
  classifyMessage,
  extractCaption,
  extractTextBody,
  jidIsGroup,
  messageTs,
  shouldSaveMediaKind,
} from "./media.js";
import { resolveBackupFolder } from "./group-map.js";
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
import {
  buildMediaTags,
  createChatEventBuffer,
  extractNearbyCaptions,
  formatSendDate,
  mergeCaptionsIntoTags,
  senderFromMessageKey,
  writeMediaTags,
} from "./tags.js";
import {
  extractRevokeTargetKey,
  isRevokeProtocolMessage,
  isRevokeUpdate,
  revokeAndDeleteBackup,
} from "./revoke.js";

/**
 * Incoming media → PHOTO_BACKUP_ROOT\<group-or-individual>\YYYY-MM-DD\<file>
 * Group folder = live WhatsApp subject (sanitized); 1:1 → individual.
 * Saves images + PDFs with tag sidecars. Incoming only; never sends.
 * On delete-for-everyone (Baileys REVOKE), deletes mapped backup file(s)
 * under PHOTO_BACKUP_ROOT only. Patterns adapted from whatsapp-media-saver.
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

  const chatEvents = createChatEventBuffer({
    windowSec: 5 * 60,
  });

  const timeZone = baileysCfg.timezone || "Asia/Hong_Kong";

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

  function noteTextMessage(msg) {
    const key = msg.key || {};
    if (key.fromMe) return;
    if (!msg.message) return;
    const classified = classifyMessage(msg.message);
    if (classified.kind !== "text") return;
    const text = extractTextBody(classified.content);
    if (!text) return;
    const chatId = key.remoteJid;
    const sender = senderFromMessageKey(key);
    const ts = messageTs(msg);
    chatEvents.pushEvent({ chatId, ts, sender, text, kind: "text" });

    // Late caption: merge into recently saved media within ±5 minutes.
    for (const m of chatEvents.mediaNeedingCaption({
      chatId,
      sender,
      ts,
      text,
    })) {
      try {
        mergeCaptionsIntoTags(m.destPath, [text]);
        logger.debug(
          { file: path.basename(m.destPath), sender },
          "merged nearby caption into tags"
        );
      } catch (err) {
        logger.warn(
          { err: err?.message, file: m.destPath },
          "failed to merge caption into tags"
        );
      }
    }
  }

  async function handleIncomingMedia(msg) {
    const key = msg.key || {};
    if (key.fromMe) return; // incoming only — never touch outbound
    if (!msg.message) return;

    // Always harvest text for the ±5 min caption window (even when not saving).
    noteTextMessage(msg);

    const classified = classifyMessage(msg.message);
    if (!shouldSaveMediaKind(classified.kind, baileysCfg.mediaTypes)) {
      return;
    }

    const msgKey = buildMsgKey(key);
    const existing = getProcessed(state, msgKey);
    if (
      existing?.status === "saved" ||
      existing?.status === "skipped" ||
      existing?.status === "revoked"
    ) {
      logger.debug({ msgKey, status: existing?.status }, "already processed — skip");
      return;
    }

    const chatId = key.remoteJid;
    const isGroup = jidIsGroup(chatId);
    const ts = messageTs(msg);
    const sender = senderFromMessageKey(key);
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

    // Own caption also feeds the event buffer (same-sender window).
    if (caption) {
      chatEvents.pushEvent({
        chatId,
        ts,
        sender,
        text: caption,
        kind: "caption",
      });
    }

    let subject = null;
    if (isGroup) {
      subject = await refreshGroupName(chatId);
    }
    const mapped = resolveBackupFolder({
      isGroup,
      subject,
      individualFolder: baileysCfg.individualFolder || "individual",
    });
    const groupFolder = mapped.folder;
    const mapReason = mapped.reason;

    const day = dayFolderFromTs(ts, timeZone);
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
      dests: [absoluteFile],
      remoteJid: chatId,
      participant: key.participant || "",
      messageId: key.id || "",
    });
    scheduleSave();

    await queue.enqueue(async () => {
      const tmpName = `${Date.now()}_${shortId}${ext}`;
      const tmpPath = path.join(tmpDir, tmpName);
      try {
        // Revoke may have won the race while we waited in the download queue.
        if (getProcessed(state, msgKey)?.status === "revoked") {
          logger.info(
            { msgKey },
            "skipping download — message revoked before save completed"
          );
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          return;
        }

        await downloadToFile(sock, msg, tmpPath, logger);

        if (getProcessed(state, msgKey)?.status === "revoked") {
          logger.info(
            { msgKey },
            "discarding download — message revoked during download"
          );
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          return;
        }

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

        // Persist real path immediately so a concurrent revoke can delete it
        // (collision rename may differ from the pending dest).
        const prior = getProcessed(state, msgKey);
        markProcessed(state, msgKey, {
          status: prior?.status === "revoked" ? "revoked" : "pending",
          group: groupFolder,
          day,
          dest: finalAbs,
          dests: [finalAbs],
          mediaType: classified.kind,
          remoteJid: chatId,
          participant: key.participant || "",
          messageId: key.id || "",
          revokedAt: prior?.revokedAt,
        });
        scheduleSave();

        if (getProcessed(state, msgKey)?.status === "revoked") {
          handleRevokeForKey(
            {
              remoteJid: chatId,
              id: key.id || "",
              fromMe: Boolean(key.fromMe),
              participant: key.participant || "",
            },
            { afterSaveRace: true }
          );
          return;
        }

        const captions = extractNearbyCaptions({
          mediaTs: ts,
          mediaSender: sender,
          mediaCaption: caption,
          events: chatEvents.eventsFor(chatId),
        });
        const tags = buildMediaTags({
          sender,
          sendTs: ts,
          sendDate: formatSendDate(ts, timeZone),
          captions,
          mediaType: classified.kind,
          fileName: path.basename(finalAbs),
          msgKey,
        });
        try {
          writeMediaTags(finalAbs, tags);
        } catch (tagErr) {
          logger.warn(
            { err: tagErr?.message, file: finalAbs },
            "saved media but failed to write tags sidecar"
          );
        }
        chatEvents.rememberSavedMedia({
          chatId,
          sender,
          ts,
          destPath: finalAbs,
        });

        // Final race: if revoked during tag write, delete immediately.
        if (getProcessed(state, msgKey)?.status === "revoked") {
          handleRevokeForKey(
            {
              remoteJid: chatId,
              id: key.id || "",
              fromMe: Boolean(key.fromMe),
              participant: key.participant || "",
            },
            { afterSaveRace: true }
          );
          return;
        }

        markProcessed(state, msgKey, {
          status: "saved",
          group: groupFolder,
          day,
          dest: finalAbs,
          dests: [finalAbs],
          mediaType: classified.kind,
          remoteJid: chatId,
          participant: key.participant || "",
          messageId: key.id || "",
        });
        scheduleSave();

        logger.info(
          {
            file: path.join(groupFolder, day, path.basename(finalAbs)),
            type: classified.kind,
            sender,
            mapReason,
          },
          classified.kind === "pdf" ? "saved pdf" : "saved photo"
        );
      } catch (err) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        if (getProcessed(state, msgKey)?.status === "revoked") return;
        markProcessed(state, msgKey, {
          status: "failed",
          group: groupFolder,
          day,
          dest: absoluteFile,
          dests: [absoluteFile],
          error: err?.message || String(err),
        });
        scheduleSave();
        logger.error({ err: err?.message, msgKey }, "download failed");
      }
    });
  }

  /**
   * Delete local backup file(s) for a revoked WhatsApp message key.
   * @param {{ remoteJid: string, id: string, fromMe: boolean, participant: string }} targetKey
   * @param {{ afterSaveRace?: boolean }} [meta]
   */
  function handleRevokeForKey(targetKey, meta = {}) {
    if (!targetKey?.id) return;
    const result = revokeAndDeleteBackup({
      state,
      targetKey,
      photoBackupRoot,
    });
    scheduleSave();

    if (result.noMapping) {
      logger.info(
        {
          remoteJid: targetKey.remoteJid,
          id: targetKey.id,
          participant: targetKey.participant || undefined,
        },
        "revoke received but no local backup mapping — nothing to delete"
      );
      return;
    }

    for (const file of result.deleted) {
      logger.info(
        {
          file,
          msgKeys: result.matchedKeys,
          afterSaveRace: meta.afterSaveRace || undefined,
        },
        "deleted backup file due to WhatsApp revoke (delete for everyone)"
      );
    }
    for (const file of result.skipped) {
      logger.warn(
        { file, msgKeys: result.matchedKeys },
        "revoke skip — path outside PHOTO_BACKUP_ROOT"
      );
    }
    for (const e of result.errors) {
      logger.error(
        { file: e.path, err: e.error, msgKeys: result.matchedKeys },
        "revoke delete failed"
      );
    }
  }

  function handleRevokeSource(source) {
    const targetKey = extractRevokeTargetKey(source);
    if (!targetKey) return;
    handleRevokeForKey(targetKey);
  }

  function onMessagesUpsert(upsert) {
    const messages = upsert?.messages || [];
    for (const msg of messages) {
      if (isRevokeProtocolMessage(msg)) {
        handleRevokeSource(msg);
        continue;
      }
      handleIncomingMedia(msg).catch((err) => {
        logger.error({ err: err?.message }, "handleIncomingMedia error");
      });
    }
  }

  function onMessagesUpdate(updates) {
    for (const item of updates || []) {
      if (!isRevokeUpdate(item)) continue;
      handleRevokeSource(item);
    }
  }

  function attach() {
    sock.ev.on("messages.upsert", onMessagesUpsert);
    sock.ev.on("messages.update", onMessagesUpdate);
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
    handleRevokeForKey,
    onMessagesUpdate,
    chatEvents,
  };
}
