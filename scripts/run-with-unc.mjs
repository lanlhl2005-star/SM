#!/usr/bin/env node
/**
 * Cross-platform launcher: set NODE_UNC_HOST_ALLOWLIST from config/.env UNC
 * roots, then spawn Node with the remaining argv.
 *
 * Why a child process? Electron/Cursor-patched Node reads
 * NODE_UNC_HOST_ALLOWLIST only at process start. Official nodejs.org builds
 * ignore this env (no ERR_UNC_HOST_NOT_ALLOWED there) — for stock Node prefer
 * mapped drives via SHARE_DRIVE / src/unc-mapped-drive.js in config.
 *
 * Usage (via package.json):
 *   node scripts/run-with-unc.mjs src/server.js
 *   node scripts/run-with-unc.mjs --watch src/server.js
 *   node scripts/run-with-unc.mjs src/wa-backup/index.js run
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyUncHostAllowlist,
  uncHostsFromPaths,
} from "../src/unc-allowlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const dotenvPath = path.join(ROOT, ".env");
  if (!fs.existsSync(dotenvPath)) return;
  const text = fs.readFileSync(dotenvPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadDefaultPaths() {
  const defaultsPath = path.join(ROOT, "config", "default.json");
  try {
    const defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
    return {
      photoBackupRoot: defaults?.paths?.photoBackupRoot || "",
      siteMemoRoot: defaults?.paths?.siteMemoRoot || "",
    };
  } catch {
    return { photoBackupRoot: "", siteMemoRoot: "" };
  }
}

function collectPaths() {
  loadDotEnv();
  const defaults = loadDefaultPaths();
  return [
    process.env.PHOTO_BACKUP_ROOT || defaults.photoBackupRoot,
    process.env.SITE_MEMO_ROOT || defaults.siteMemoRoot,
  ].filter(Boolean);
}

const nodeArgs = process.argv.slice(2);
if (nodeArgs.length === 0) {
  console.error(
    "Usage: node scripts/run-with-unc.mjs [--watch] <script> [args...]"
  );
  process.exit(1);
}

const hosts = uncHostsFromPaths(collectPaths());
const { hosts: applied } = applyUncHostAllowlist(hosts);

if (process.platform === "win32" && applied.length) {
  // One quiet line so Windows users can confirm the allowlist is active.
  console.error(`[unc] NODE_UNC_HOST_ALLOWLIST=${process.env.NODE_UNC_HOST_ALLOWLIST}`);
}

const child = spawn(process.execPath, nodeArgs, {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (err) => {
  console.error(`run-with-unc: failed to spawn node: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
