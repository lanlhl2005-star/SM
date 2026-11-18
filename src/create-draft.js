import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { writeSiteMemoDoc } from "./generate-doc.js";
import {
  formatDocSeq,
  formatFolderNn,
  nextMemoSequence,
} from "./memo-number.js";
import {
  draftFolderName,
  memoFileName,
  resolvePhotoPath,
  sanitizeShortSubject,
} from "./paths.js";

function todayDdMmYyyy() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Create Draft-only Site Memo folder + unlocked .doc.
 * Never writes (Submitted).
 */
export function createDraftMemo(input) {
  const subject = String(input.subject || "").trim();
  if (!subject) throw new Error("subject is required");

  const photoBlocksIn = Array.isArray(input.photo_blocks) ? input.photo_blocks : [];
  const photo_blocks = photoBlocksIn.map((b, i) => {
    if (!b || !b.image) throw new Error(`photo_blocks[${i}].image is required`);
    const absolutePath = resolvePhotoPath(b.image);
    return {
      image: b.image,
      absolutePath,
      caption: String(b.caption ?? "").trim() || `Photo ${i + 1}`,
    };
  });

  const seq = nextMemoSequence();
  const nn = formatFolderNn(seq);
  const seq3 = formatDocSeq(seq);
  const shortSubject = sanitizeShortSubject(input.short_subject || subject);
  const folder = draftFolderName(nn, shortSubject);

  if (/\(Submitted\)/i.test(folder)) {
    throw new Error("Refusing to create a (Submitted) folder");
  }

  const folderPath = path.join(config.siteMemoRoot, folder);
  if (fs.existsSync(folderPath)) {
    throw new Error(`Draft folder already exists: ${folder}`);
  }

  const file = memoFileName(seq3);
  const filePath = path.join(folderPath, file);

  fs.mkdirSync(folderPath, { recursive: true });

  const body_items =
    Array.isArray(input.body_items) && input.body_items.length
      ? input.body_items
      : [input.body_bullet_1, input.body_bullet_2].filter(
          (x) => x != null && String(x).trim() !== ""
        );

  writeSiteMemoDoc(filePath, {
    date: input.date || todayDdMmYyyy(),
    memo_number: seq3,
    copy_to: input.copy_to ?? "",
    subject,
    body_intro: input.body_intro || "",
    body_items,
    photo_blocks,
  });

  return {
    sequence: seq,
    memo_number: seq3,
    folder_nn: nn,
    folder_name: folder,
    folder_path: folderPath,
    file_name: file,
    file_path: filePath,
    status: "Draft",
    photo_count: photo_blocks.length,
  };
}
