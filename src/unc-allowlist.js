/**
 * Windows UNC host allowlist helpers.
 *
 * Some Node builds used on Windows (notably Electron/Cursor-patched Node, and
 * any runtime that honors NODE_UNC_HOST_ALLOWLIST) block fs access to UNC
 * paths unless the host is allowlisted. Official nodejs.org builds do not
 * implement this — the helpers no-op there.
 *
 * Allowlist format (env): backslash-separated host names, e.g.
 *   NODE_UNC_HOST_ALLOWLIST=Server
 *   NODE_UNC_HOST_ALLOWLIST=Server\fileserver
 * Matching is case-insensitive ("Server" covers \\server\share\...).
 */

/**
 * Extract the UNC host from a path like \\Server\Share\... or //Server/Share/...
 * Returns null when the path is not UNC (mapped drives, local paths).
 * @param {string} input
 * @returns {string | null}
 */
export function uncHostFromPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // DOS device UNC: \\?\UNC\Server\Share\... or \\.\UNC\Server\Share\...
  const dos = raw.match(/^[\\/]{2}[?.][\\/]UNC[\\/]([^\\/]+)/i);
  if (dos) return dos[1] || null;

  // Standard UNC: \\Server\Share\... or //Server/Share/...
  const std = raw.match(/^[\\/]{2}([^\\/]+)/);
  if (!std) return null;
  const host = std[1];
  // Exclude . and ? device prefixes mistaken as hosts.
  if (host === "." || host === "?") return null;
  return host || null;
}

/**
 * Parse NODE_UNC_HOST_ALLOWLIST (backslash-separated) into unique hosts.
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseUncHostAllowlist(value) {
  if (!value) return [];
  // Split on backslash. Hosts themselves never contain `\`.
  return String(value)
    .split("\\")
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Merge hosts case-insensitively; keep the first-seen casing.
 * @param {...(string|string[]|null|undefined)} groups
 * @returns {string[]}
 */
export function mergeUncHosts(...groups) {
  const seen = new Map();
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group ? [group] : [];
    for (const host of list) {
      const h = String(host || "").trim();
      if (!h) continue;
      const key = h.toLowerCase();
      if (!seen.has(key)) seen.set(key, h);
    }
  }
  return Array.from(seen.values());
}

/**
 * Serialize hosts for NODE_UNC_HOST_ALLOWLIST.
 * @param {string[]} hosts
 */
export function formatUncHostAllowlist(hosts) {
  return mergeUncHosts(hosts).join("\\");
}

/**
 * Collect UNC hosts from path strings (photo backup, site memo, …).
 * @param {Iterable<string>} paths
 * @returns {string[]}
 */
export function uncHostsFromPaths(paths) {
  const hosts = [];
  for (const p of paths) {
    const host = uncHostFromPath(p);
    if (host) hosts.push(host);
  }
  return mergeUncHosts(hosts);
}

/**
 * Apply hosts to process.env and, when present, process.uncHostAllowlist.
 * Safe on platforms/builds without UNC restrictions.
 * @param {string[]} hosts
 * @returns {{ hosts: string[], allowlistApi: boolean }}
 */
export function applyUncHostAllowlist(hosts) {
  const merged = mergeUncHosts(
    parseUncHostAllowlist(process.env.NODE_UNC_HOST_ALLOWLIST),
    hosts
  );

  if (merged.length) {
    process.env.NODE_UNC_HOST_ALLOWLIST = formatUncHostAllowlist(merged);
  }

  let allowlistApi = false;
  const set = /** @type {{ uncHostAllowlist?: Set<string> }} */ (process)
    .uncHostAllowlist;
  if (set && typeof set.add === "function") {
    allowlistApi = true;
    for (const host of merged) {
      set.add(host.toLowerCase());
    }
  }

  return { hosts: merged, allowlistApi };
}

/**
 * Allow UNC hosts found in the given filesystem roots.
 * @param {Iterable<string>} paths
 */
export function allowUncHostsForPaths(paths) {
  return applyUncHostAllowlist(uncHostsFromPaths(paths));
}
