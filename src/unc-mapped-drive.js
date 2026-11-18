/**
 * Rewrite Windows UNC roots (\\Server\Share\...) to an existing mapped drive
 * letter (S:\...). Works on every Node build — including official nodejs.org
 * installs under C:\Program Files\nodejs, which do NOT implement
 * NODE_UNC_HOST_ALLOWLIST / ERR_UNC_HOST_NOT_ALLOWED.
 *
 * Preferred env:
 *   SHARE_DRIVE=S:
 * Optional: rely on an existing `net use` mapping for \\Server\Share.
 */
import { execFileSync } from "node:child_process";

function looksLikeUnc(p) {
  const s = String(p || "");
  return s.startsWith("\\\\") || s.startsWith("//");
}

/**
 * Normalize separators to backslash (Windows UNC / drive form).
 * @param {string} input
 */
export function toWindowsPath(input) {
  return String(input || "").replace(/\//g, "\\");
}

/**
 * \\Server\Share\rest → \\Server\Share (share root). Null if not UNC.
 * @param {string} input
 * @returns {string | null}
 */
export function uncShareRoot(input) {
  const raw = toWindowsPath(input).trim();
  if (!looksLikeUnc(raw)) return null;
  // \\?\UNC\Server\Share\...
  const dos = raw.match(/^[\\/]{2}[?.][\\/]UNC[\\/]([^\\/]+[\\/][^\\/]+)/i);
  if (dos) return `\\\\${dos[1].replace(/\//g, "\\")}`;
  const m = raw.match(/^\\\\[^\\]+\\[^\\]+/);
  return m ? m[0] : null;
}

/**
 * Replace a UNC prefix with a drive letter.
 * @param {string} uncPath
 * @param {string} uncPrefix e.g. \\Server\Share
 * @param {string} drive e.g. S: or S
 */
export function rewriteUncPrefix(uncPath, uncPrefix, drive) {
  const pathWin = toWindowsPath(uncPath);
  const prefix = toWindowsPath(uncPrefix).replace(/\\+$/, "");
  const d = String(drive || "")
    .trim()
    .replace(/\\+$/, "")
    .replace(/:$/, "")
    .toUpperCase();
  if (!d || !/^[A-Z]$/.test(d)) return pathWin;
  if (!pathWin.toLowerCase().startsWith(prefix.toLowerCase())) return pathWin;
  const rest = pathWin.slice(prefix.length); // '' or '\Sang\...'
  if (!rest) return `${d}:\\`;
  return `${d}:${rest.startsWith("\\") ? rest : `\\${rest}`}`;
}

/**
 * Parse `net use` stdout into { drive, remote } entries.
 * @param {string} text
 * @returns {{ drive: string, remote: string }[]}
 */
export function parseNetUseOutput(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    // e.g. "OK  S:  \\Server\Share  Microsoft Windows Network"
    const m = line.match(/\b([A-Za-z]:)\s+(\\\\[\S]+)/);
    if (!m) continue;
    out.push({
      drive: m[1].toUpperCase(),
      remote: toWindowsPath(m[2]).replace(/\\+$/, ""),
    });
  }
  return out;
}

/**
 * List current Windows drive → UNC mappings via `net use`.
 * @returns {{ drive: string, remote: string }[]}
 */
export function listDriveMappings() {
  if (process.platform !== "win32") return [];
  try {
    const text = execFileSync("net", ["use"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    return parseNetUseOutput(text);
  } catch {
    return [];
  }
}

/**
 * Rewrite a UNC path using drive mappings (longest remote prefix wins).
 * @param {string} uncPath
 * @param {{ drive: string, remote: string }[]} mappings
 */
export function rewriteUncUsingMappings(uncPath, mappings) {
  const pathWin = toWindowsPath(uncPath);
  if (!looksLikeUnc(pathWin)) {
    return { path: uncPath, mapped: false };
  }
  const lower = pathWin.toLowerCase();
  const sorted = [...(mappings || [])].sort(
    (a, b) => b.remote.length - a.remote.length
  );
  for (const { drive, remote } of sorted) {
    const r = toWindowsPath(remote).replace(/\\+$/, "").toLowerCase();
    if (lower === r || lower.startsWith(r + "\\")) {
      const rewritten = rewriteUncPrefix(pathWin, remote, drive);
      return {
        path: rewritten,
        mapped: true,
        drive: drive.endsWith(":") ? drive.toUpperCase() : `${drive.toUpperCase()}:`,
        remote: toWindowsPath(remote).replace(/\\+$/, ""),
      };
    }
  }
  return { path: uncPath, mapped: false };
}

/**
 * Prefer a drive-letter path for UNC roots.
 * Order: SHARE_DRIVE / UNC_SHARE_DRIVE env → existing net-use mapping → unchanged.
 *
 * @param {string} input
 * @param {{ preferredDrive?: string, mappings?: { drive: string, remote: string }[] }} [opts]
 */
export function preferMappedDrivePath(input, opts = {}) {
  const raw = String(input || "");
  if (!looksLikeUnc(raw)) {
    return { path: raw, mapped: false };
  }

  // On non-Windows, skip unless the caller passes preferredDrive/mappings
  // (tests) — UNC is not a real network path off win32.
  const preferred =
    opts.preferredDrive ||
    process.env.SHARE_DRIVE ||
    process.env.UNC_SHARE_DRIVE ||
    "";
  const hasExplicit =
    opts.preferredDrive != null ||
    opts.mappings != null ||
    opts.forceWindows === true;
  if (process.platform !== "win32" && !hasExplicit) {
    return { path: raw, mapped: false };
  }

  const share = uncShareRoot(raw);

  if (preferred && share) {
    const path = rewriteUncPrefix(raw, share, preferred);
    return {
      path,
      mapped: path !== toWindowsPath(raw),
      via: "SHARE_DRIVE",
      drive: String(preferred).replace(/:$/, "").toUpperCase() + ":",
      remote: share,
    };
  }

  const mappings =
    opts.mappings ||
    (process.platform === "win32" ? listDriveMappings() : []);
  const rewritten = rewriteUncUsingMappings(raw, mappings);
  if (rewritten.mapped) {
    return { ...rewritten, via: "net-use" };
  }

  return {
    path: raw,
    mapped: false,
    suggestion: share
      ? `net use S: ${share}   then set SHARE_DRIVE=S: (or PHOTO_*/SITE_* under S:\\...)`
      : null,
  };
}

/**
 * Human hint when UNC access fails (any Node build).
 * @param {string} uncPath
 */
export function uncMappedDriveHint(uncPath) {
  const share = uncShareRoot(uncPath) || "\\\\Server\\Share";
  return (
    `Map the share to a drive letter (works on stock nodejs.org Node): ` +
    `net use S: ${share}  →  set SHARE_DRIVE=S: in .env  (or set PHOTO_BACKUP_ROOT / SITE_MEMO_ROOT to S:\\... paths). ` +
    `NODE_UNC_HOST_ALLOWLIST only helps Electron/Cursor-patched Node — official C:\\Program Files\\nodejs ignores it.`
  );
}
