import path from "node:path";

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tif",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
};

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Sanitize a free-text label into a safe Windows filename stem.
 * Strips illegal path chars; keeps readable Unicode (e.g. Chinese).
 */
export function sanitizeStem(input, { maxLen = 80 } = {}) {
  let s = String(input || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/[. ]+$/g, "");
  if (!s) return "";
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

/**
 * Sanitize a WhatsApp group subject into a Windows/UNC folder name segment.
 * Preserves Chinese/Unicode; strips <>:"/\|?* and control chars.
 */
export function sanitizeFolderName(input, { maxLen = 120 } = {}) {
  let s = sanitizeStem(input, { maxLen });
  if (!s) return "";
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  return s;
}

export function extensionFromMeta({ mimetype, fileName, mediaType } = {}) {
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) return ext.toLowerCase();
  }
  if (mimetype && EXT_BY_MIME[mimetype.toLowerCase()]) {
    return EXT_BY_MIME[mimetype.toLowerCase()];
  }
  if (mediaType === "image") return ".jpg";
  if (mediaType === "video") return ".mp4";
  if (mediaType === "document") return ".bin";
  return ".bin";
}

export function nextAvailableFileName(stem, ext, existsInFolder) {
  let name = `${stem}${ext}`;
  if (!existsInFolder(name)) return name;
  let n = 2;
  while (existsInFolder(`${stem}_${n}${ext}`)) n += 1;
  return `${stem}_${n}${ext}`;
}

/**
 * Prefer caption, else original file stem, else WA_<shortId>.
 */
export function resolveFileStem({ caption, originalFileName, shortMsgId }) {
  const fromCaption = sanitizeStem(caption);
  if (fromCaption) return fromCaption;
  if (originalFileName) {
    const stem = sanitizeStem(path.basename(originalFileName, path.extname(originalFileName)));
    if (stem) return stem;
  }
  return `WA_${shortMsgId || "media"}`;
}

/**
 * Day folder YYYY-MM-DD in a fixed timezone (default Asia/Hong_Kong).
 */
export function dayFolderFromTs(tsSec, timeZone = "Asia/Hong_Kong") {
  const d = new Date(Number(tsSec) * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}
