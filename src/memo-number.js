import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Scan Site Memo root for SM-{nn} folders (and optional .doc filenames)
 * and return the next sequence. Folder style is two-digit (SM-06);
 * document uses three-digit (006). No Rn revisions.
 */
export function scanExistingSequences() {
  const root = config.siteMemoRoot;
  const nums = new Set();
  if (!fs.existsSync(root)) return nums;

  for (const name of fs.readdirSync(root)) {
    const m = /^SM-(\d+)\b/i.exec(name);
    if (m) nums.add(Number(m[1]));

    const full = path.join(root, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      const fm = /SM-(\d{1,4})(?:R\d+)?\.doc$/i.exec(file);
      if (fm) nums.add(Number(fm[1]));
    }
  }
  return nums;
}

export function nextMemoSequence() {
  const nums = scanExistingSequences();
  let max = 0;
  for (const n of nums) if (n > max) max = n;
  return max + 1;
}

export function formatFolderNn(n) {
  return String(n).padStart(2, "0");
}

export function formatDocSeq(n) {
  return String(n).padStart(3, "0");
}
