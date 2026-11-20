import fs from "node:fs";
import path from "node:path";

/**
 * Parse one .env assignment line.
 * @param {string} rawLine
 * @returns {{ key: string, value: string } | null}
 */
export function parseDotEnvLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line || line.startsWith("#")) return null;
  const eq = line.indexOf("=");
  if (eq < 1) return null;

  let key = line.slice(0, eq).trim();
  if (/^export\s+/i.test(key)) {
    key = key.replace(/^export\s+/i, "").trim();
  }
  // Reject empty or whitespace-containing keys (invalid in env).
  if (!key || /\s/.test(key)) return null;

  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Apply .env text into `env`.
 *
 * Rules (fix gate-not-loading bugs):
 * - Strip UTF-8 BOM
 * - Support optional `export KEY=value`
 * - Within the file, a later non-empty value overrides an earlier empty one
 * - Do not override a non-empty value already present in `env`
 * - An empty .env assignment must not block a later non-empty line for the same key
 *
 * @param {string} text
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {Record<string, string>} keys written (final values)
 */
export function applyDotEnvText(text, env = process.env) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  /** @type {Record<string, string>} */
  const applied = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(rawLine);
    if (!parsed) continue;
    const { key, value } = parsed;

    const existing = env[key];
    const existingNonEmpty =
      existing !== undefined && String(existing).trim() !== "";

    // Preserve non-empty values already in the process environment.
    if (existingNonEmpty) continue;

    // Skip empty file assignments when they would only install a blank placeholder
    // that blocks a later real value in the same file — unless we need to record
    // the key as present. Prefer: only write non-empty, OR write empty only when
    // unset so later non-empty can overwrite.
    if (value.trim() === "") {
      if (existing === undefined) {
        env[key] = "";
        applied[key] = "";
      }
      continue;
    }

    // Non-empty .env value: set when unset OR when existing is empty/whitespace.
    env[key] = value;
    applied[key] = value;
  }

  return applied;
}

/**
 * Load repo-root `.env` into `env` (default process.env).
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ loaded: boolean, path: string, applied: Record<string, string> }}
 */
export function loadDotEnvFile(rootDir, env = process.env) {
  const dotenvPath = path.join(rootDir, ".env");
  if (!fs.existsSync(dotenvPath)) {
    return { loaded: false, path: dotenvPath, applied: {} };
  }
  const text = fs.readFileSync(dotenvPath, "utf8");
  const applied = applyDotEnvText(text, env);
  return { loaded: true, path: dotenvPath, applied };
}
