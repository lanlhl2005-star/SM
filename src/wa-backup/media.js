/**
 * Classify Baileys message content. Site Memo backup saves images by default.
 * Patterns adapted from whatsapp-media-saver.
 */

/**
 * Unwrap ephemeral / view-once wrappers to the inner message object.
 * @param {object|null|undefined} message
 */
export function unwrapMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (message.ephemeralMessage?.message) {
    return unwrapMessage(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage?.message) {
    return unwrapMessage(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2?.message) {
    return unwrapMessage(message.viewOnceMessageV2.message);
  }
  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(message.viewOnceMessageV2Extension.message);
  }
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }
  return message;
}

/**
 * @returns {{ kind: string, content: object|null, contentType: string|null }}
 */
export function classifyMessage(message) {
  const inner = unwrapMessage(message);
  if (!inner) return { kind: "none", content: null, contentType: null };

  if (inner.imageMessage) {
    return {
      kind: "image",
      content: inner.imageMessage,
      contentType: "imageMessage",
    };
  }
  if (inner.videoMessage) {
    return {
      kind: "video",
      content: inner.videoMessage,
      contentType: "videoMessage",
    };
  }
  if (inner.documentMessage) {
    return {
      kind: "document",
      content: inner.documentMessage,
      contentType: "documentMessage",
    };
  }
  if (inner.audioMessage) {
    const ptt = Boolean(inner.audioMessage.ptt);
    return {
      kind: ptt ? "ptt" : "audio",
      content: inner.audioMessage,
      contentType: "audioMessage",
    };
  }
  if (inner.stickerMessage) {
    return {
      kind: "sticker",
      content: inner.stickerMessage,
      contentType: "stickerMessage",
    };
  }
  if (inner.conversation || inner.extendedTextMessage) {
    return { kind: "text", content: inner, contentType: "text" };
  }
  return { kind: "other", content: inner, contentType: null };
}

export function shouldSaveMediaKind(kind, allowed = ["image"]) {
  const allow = new Set(allowed?.length ? allowed : ["image"]);
  return allow.has(kind);
}

export function extractCaption(content) {
  if (!content || typeof content !== "object") return null;
  const cap = content.caption || content.title || null;
  if (typeof cap === "string" && cap.trim()) return cap.trim();
  return null;
}

/** Build Baileys message key string for dedupe. */
export function buildMsgKey({ remoteJid, id, fromMe, participant } = {}) {
  return [remoteJid || "", id || "", fromMe ? "1" : "0", participant || ""].join(
    "|"
  );
}

export function messageTs(msg) {
  const t = Number(msg.messageTimestamp);
  if (Number.isFinite(t)) return t < 1e12 ? t : Math.floor(t / 1000);
  return Math.floor(Date.now() / 1000);
}

export function jidIsGroup(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}
