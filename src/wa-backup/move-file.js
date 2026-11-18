/**
 * Move a file, including across devices / UNC shares.
 *
 * Windows cannot `rename` from a local volume (e.g. F:\SM\.wa-backup-tmp)
 * onto a UNC path (\\Server\Share\…). That yields EXDEV. On failure we
 * copy to a sibling .tmp on the destination volume, rename within that
 * volume (atomic-ish), then unlink the source.
 *
 * Paths are normal JS strings — Node keeps Unicode (e.g. 火炭) intact;
 * do not re-encode for Windows.
 */
import fs from "node:fs";
import path from "node:path";

const CROSS_DEVICE_CODES = new Set(["EXDEV", "EPERM"]);

/**
 * @param {string} src
 * @param {string} dest
 * @param {{
 *   rename?: (from: string, to: string) => Promise<void>,
 *   copyFile?: (from: string, to: string) => Promise<void>,
 *   unlink?: (p: string) => Promise<void>,
 *   mkdir?: (p: string, opts?: object) => Promise<void>,
 * }} [ops]  Injectable fs ops (tests).
 */
export async function moveFile(src, dest, ops = {}) {
  const rename = ops.rename || ((a, b) => fs.promises.rename(a, b));
  const copyFile = ops.copyFile || ((a, b) => fs.promises.copyFile(a, b));
  const unlink = ops.unlink || ((p) => fs.promises.unlink(p));
  const mkdir = ops.mkdir || ((p, o) => fs.promises.mkdir(p, o));

  await mkdir(path.dirname(dest), { recursive: true });

  try {
    await rename(src, dest);
    return { method: "rename" };
  } catch (err) {
    if (!CROSS_DEVICE_CODES.has(err?.code)) throw err;
  }

  // Sibling staging name on the destination volume (same directory → rename OK).
  const staging = `${dest}.${process.pid}.${Date.now()}.moving`;
  try {
    await copyFile(src, staging);
    await rename(staging, dest);
  } catch (err) {
    try {
      await unlink(staging);
    } catch {
      /* ignore */
    }
    throw err;
  }

  try {
    await unlink(src);
  } catch (err) {
    // Dest is already committed; surface source cleanup failure but keep dest.
    if (err?.code !== "ENOENT") throw err;
  }

  return { method: "copy" };
}
