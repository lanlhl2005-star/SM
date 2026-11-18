import path from "node:path";
import { config } from "../config.js";

/**
 * Best-effort chat/group → backup folder mapping.
 *
 * WhatsApp Desktop media cache often does NOT label files with a group id.
 * We only get a reliable mapping when:
 *   - a parent folder name matches a configured group (manual staging folders), or
 *   - the relative path / filename contains a configured hint string.
 *
 * Otherwise we fall back to config.whatsappDesktop.fallbackGroup (default: unmapped).
 */
export function listKnownGroups() {
  return Object.keys(config.whatsappDesktop.groupMap || {});
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} absolutePath
 * @param {string} mediaRoot
 * @returns {{ group: string, reason: string }}
 */
export function mapSourceToGroup(absolutePath, mediaRoot) {
  const groupMap = config.whatsappDesktop.groupMap || {};
  const rel = path.relative(mediaRoot, absolutePath).replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  const parentDirs = parts.slice(0, -1);
  const fileName = parts[parts.length - 1] || path.basename(absolutePath);
  const haystack = normalize(rel);

  for (const [group, rules] of Object.entries(groupMap)) {
    const matchNames = (rules.matchNames || []).map(normalize);
    const pathIncludes = (rules.pathIncludes || []).map(normalize);

    for (const dir of parentDirs) {
      const nd = normalize(dir);
      if (matchNames.includes(nd) || pathIncludes.includes(nd)) {
        return {
          group,
          reason: `parent folder "${dir}" matched group "${group}"`,
        };
      }
    }

    for (const hint of [...matchNames, ...pathIncludes]) {
      if (!hint) continue;
      if (haystack.includes(hint) || normalize(fileName).includes(hint)) {
        return {
          group,
          reason: `path/filename contains hint "${hint}" → "${group}"`,
        };
      }
    }
  }

  return {
    group: config.whatsappDesktop.fallbackGroup,
    reason:
      "no folder/name hint matched; Desktop cache often omits group identity — using fallback",
  };
}
