/**
 * Media tags for Baileys backup: sender, send date, nearby caption/message.
 * Sidecar `.tags.json` next to each file + day-folder `tags.json` index (UI-searchable).
 * No backfill — tags are written only for newly saved files.
 */

import fs from "node:fs";
import path from "node:path";

/** ±5 minutes around the media message (seconds). */
export const CAPTION_WINDOW_SEC = 5 * 60;

/**
 * Readable sender id from a WhatsApp JID.
 * `85291234567@s.whatsapp.net` → `85291234567`
 * Groups / LIDs keep a stable readable form.
 */
export function formatSenderNumber(jid) {
  if (!jid || typeof jid !== "string") return "unknown";
  const bare = jid.split("@")[0] || jid;
  // Strip device suffix like :12 on multi-device
  const noDevice = bare.split(":")[0] || bare;
  return noDevice || "unknown";
}

/**
 * Sender of an incoming message: group participant, else chat JID.
 */
export function senderFromMessageKey(key = {}) {
  if (key.participant) return formatSenderNumber(key.participant);
  return formatSenderNumber(key.remoteJid);
}

/**
 * Local datetime string for tags (includes time).
 * @param {number} tsSec Unix seconds
 * @param {string} [timeZone]
 */
export function formatSendDate(tsSec, timeZone = "Asia/Hong_Kong") {
  const d = new Date(Number(tsSec) * 1000);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Collect caption / nearby text within ±windowSec of mediaTs from the same sender.
 * Media's own caption counts; nearby text events must match sender.
 *
 * @param {object} opts
 * @param {number} opts.mediaTs
 * @param {string} opts.mediaSender
 * @param {string|null} [opts.mediaCaption] caption on the media message itself
 * @param {Array<{ ts: number, sender: string, text: string }>} opts.events
 * @param {number} [opts.windowSec]
 * @returns {string[]}
 */
export function extractNearbyCaptions({
  mediaTs,
  mediaSender,
  mediaCaption = null,
  events = [],
  windowSec = CAPTION_WINDOW_SEC,
} = {}) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  push(mediaCaption);

  const sender = String(mediaSender || "");
  const lo = Number(mediaTs) - windowSec;
  const hi = Number(mediaTs) + windowSec;
  for (const ev of events) {
    if (!ev) continue;
    if (String(ev.sender || "") !== sender) continue;
    const ts = Number(ev.ts);
    if (!Number.isFinite(ts) || ts < lo || ts > hi) continue;
    push(ev.text);
  }
  return out;
}

/**
 * Build the durable tag object stored next to a media file.
 */
export function buildMediaTags({
  sender,
  sendTs,
  sendDate,
  captions = [],
  mediaType,
  fileName,
  msgKey = null,
} = {}) {
  const list = Array.isArray(captions)
    ? captions.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  return {
    sender: sender || "unknown",
    sendDate: sendDate || "",
    sendTs: Number.isFinite(Number(sendTs)) ? Number(sendTs) : null,
    caption: list[0] || "",
    captions: list,
    mediaType: mediaType || "image",
    fileName: fileName || "",
    msgKey: msgKey || null,
  };
}

/** Sidecar path: `photo.jpg` → `photo.jpg.tags.json` (survives UNC, searchable). */
export function tagsSidecarPath(mediaPath) {
  return `${mediaPath}.tags.json`;
}

export function dayTagsIndexPath(dayDir) {
  return path.join(dayDir, "tags.json");
}

/**
 * Write per-file sidecar and upsert into day-folder tags.json index.
 * @returns {object} tags written
 */
export function writeMediaTags(mediaPath, tags) {
  const sidecar = tagsSidecarPath(mediaPath);
  const payload = {
    ...tags,
    fileName: tags.fileName || path.basename(mediaPath),
  };
  fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), "utf8");

  const dayDir = path.dirname(mediaPath);
  const indexPath = dayTagsIndexPath(dayDir);
  let index = { files: {} };
  try {
    if (fs.existsSync(indexPath)) {
      const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (raw && typeof raw === "object") {
        index = {
          files:
            raw.files && typeof raw.files === "object" ? { ...raw.files } : {},
        };
      }
    }
  } catch {
    index = { files: {} };
  }
  index.files[path.basename(mediaPath)] = payload;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  return payload;
}

/**
 * Merge additional caption strings into an existing sidecar (late ±5 min texts).
 */
export function mergeCaptionsIntoTags(mediaPath, extraCaptions = []) {
  const sidecar = tagsSidecarPath(mediaPath);
  let tags = null;
  try {
    if (fs.existsSync(sidecar)) {
      tags = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    }
  } catch {
    tags = null;
  }
  if (!tags || typeof tags !== "object") return null;
  const seen = new Set();
  const captions = [];
  for (const c of [...(tags.captions || []), ...extraCaptions]) {
    const t = String(c || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    captions.push(t);
  }
  const next = {
    ...tags,
    captions,
    caption: captions[0] || tags.caption || "",
  };
  return writeMediaTags(mediaPath, next);
}

/**
 * Load tags for a media file (sidecar first, then day index).
 */
export function readMediaTags(mediaPath) {
  const sidecar = tagsSidecarPath(mediaPath);
  try {
    if (fs.existsSync(sidecar)) {
      return JSON.parse(fs.readFileSync(sidecar, "utf8"));
    }
  } catch {
    /* fall through */
  }
  const indexPath = dayTagsIndexPath(path.dirname(mediaPath));
  try {
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const name = path.basename(mediaPath);
      return index?.files?.[name] || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Case-insensitive substring match helper.
 */
function includesFold(hay, needle) {
  if (!needle) return true;
  return String(hay || "")
    .toLowerCase()
    .includes(String(needle).toLowerCase());
}

/**
 * Filter media list entries that carry `.tags` (or top-level sender/caption fields).
 * @param {Array<object>} items
 * @param {{ sender?: string, date?: string, text?: string }} filters
 */
export function filterMediaByTags(items, filters = {}) {
  const senderQ = String(filters.sender || "").trim();
  const dateQ = String(filters.date || "").trim();
  const textQ = String(filters.text || "").trim();
  if (!senderQ && !dateQ && !textQ) return items;

  return items.filter((item) => {
    const tags = item.tags || item;
    const sender = tags.sender || item.sender || "";
    const sendDate = tags.sendDate || item.sendDate || "";
    const captions = [
      tags.caption,
      ...(Array.isArray(tags.captions) ? tags.captions : []),
      item.name,
    ]
      .filter(Boolean)
      .join("\n");

    if (senderQ && !includesFold(sender, senderQ)) return false;
    if (dateQ && !includesFold(sendDate, dateQ) && !includesFold(item.day, dateQ)) {
      return false;
    }
    if (textQ && !includesFold(captions, textQ)) return false;
    return true;
  });
}

/**
 * In-memory ring of recent chat events for ±5 min caption resolution.
 */
export function createChatEventBuffer({
  windowSec = CAPTION_WINDOW_SEC,
  maxPerChat = 200,
} = {}) {
  /** @type {Map<string, Array<{ ts: number, sender: string, text: string, kind: string }>>} */
  const byChat = new Map();
  /** Recently saved media for late caption merge */
  /** @type {Array<{ chatId: string, sender: string, ts: number, destPath: string }>} */
  const recentMedia = [];

  function prune(nowTs) {
    const cutoff = nowTs - windowSec * 2;
    for (const [chatId, list] of byChat) {
      const next = list.filter((e) => e.ts >= cutoff);
      if (next.length) byChat.set(chatId, next);
      else byChat.delete(chatId);
    }
    while (recentMedia.length && recentMedia[0].ts < cutoff) {
      recentMedia.shift();
    }
  }

  function pushEvent({ chatId, ts, sender, text, kind = "text" }) {
    if (!chatId || !text) return;
    prune(Number(ts) || Math.floor(Date.now() / 1000));
    const list = byChat.get(chatId) || [];
    list.push({
      ts: Number(ts),
      sender: String(sender || ""),
      text: String(text).trim(),
      kind,
    });
    while (list.length > maxPerChat) list.shift();
    byChat.set(chatId, list);
  }

  function eventsFor(chatId) {
    return byChat.get(chatId) || [];
  }

  function rememberSavedMedia(entry) {
    recentMedia.push(entry);
    prune(entry.ts);
  }

  function mediaNeedingCaption({ chatId, sender, ts, text }) {
    if (!text) return [];
    const lo = Number(ts) - windowSec;
    const hi = Number(ts) + windowSec;
    return recentMedia.filter(
      (m) =>
        m.chatId === chatId &&
        m.sender === sender &&
        m.ts >= lo &&
        m.ts <= hi
    );
  }

  return {
    pushEvent,
    eventsFor,
    rememberSavedMedia,
    mediaNeedingCaption,
    prune,
    /** @internal test helper */
    _recentMedia: recentMedia,
    _byChat: byChat,
  };
}
