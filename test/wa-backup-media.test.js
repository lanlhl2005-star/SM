import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMessage,
  isPdfDocument,
  shouldSaveMediaKind,
  unwrapMessage,
} from "../src/wa-backup/media.js";
import { extensionFromMeta, resolveFileStem } from "../src/wa-backup/naming.js";
import { resolveBackupFolder } from "../src/wa-backup/group-map.js";
import { dayFolderFromTs } from "../src/wa-backup/naming.js";

test("isPdfDocument detects mimetype and filename", () => {
  assert.equal(isPdfDocument({ mimetype: "application/pdf" }), true);
  assert.equal(isPdfDocument({ fileName: "note.PDF" }), true);
  assert.equal(
    isPdfDocument({ mimetype: "application/msword", fileName: "a.doc" }),
    false
  );
});

test("classifyMessage maps PDF documents to kind pdf", () => {
  const pdf = classifyMessage({
    documentMessage: {
      mimetype: "application/pdf",
      fileName: "delivery.pdf",
      caption: "delivery note",
    },
  });
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.contentType, "documentMessage");

  const doc = classifyMessage({
    documentMessage: {
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "memo.docx",
    },
  });
  assert.equal(doc.kind, "document");

  const img = classifyMessage({
    imageMessage: { mimetype: "image/jpeg", caption: "plant" },
  });
  assert.equal(img.kind, "image");
});

test("classifyMessage unwraps documentWithCaptionMessage PDF", () => {
  const classified = classifyMessage({
    documentWithCaptionMessage: {
      message: {
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "wrapped.pdf",
        },
      },
    },
  });
  assert.equal(classified.kind, "pdf");
  assert.ok(unwrapMessage);
});

test("shouldSaveMediaKind allows image and pdf by default", () => {
  assert.equal(shouldSaveMediaKind("image"), true);
  assert.equal(shouldSaveMediaKind("pdf"), true);
  assert.equal(shouldSaveMediaKind("video"), false);
  assert.equal(shouldSaveMediaKind("document"), false);
  assert.equal(shouldSaveMediaKind("pdf", ["image"]), false);
});

test("PDF save path: group subject day folder + .pdf extension", () => {
  const mapped = resolveBackupFolder({
    isGroup: true,
    subject: "CMI 火炭 MVAC",
    individualFolder: "individual",
  });
  assert.equal(mapped.folder, "CMI 火炭 MVAC");

  const day = dayFolderFromTs(1794969000, "Asia/Hong_Kong");
  assert.equal(day, "2026-11-18");

  const ext = extensionFromMeta({
    mimetype: "application/pdf",
    fileName: "delivery note.pdf",
    mediaType: "pdf",
  });
  assert.equal(ext, ".pdf");

  const stem = resolveFileStem({
    caption: null,
    originalFileName: "delivery note.pdf",
    shortMsgId: "deadbeef",
  });
  assert.equal(stem, "delivery note");

  // Relative path under backup root (same layout as photos).
  const relative = [mapped.folder, day, `${stem}${ext}`].join("/");
  assert.equal(relative, "CMI 火炭 MVAC/2026-11-18/delivery note.pdf");
});

test("individual chat PDF path uses individual/YYYY-MM-DD", () => {
  const mapped = resolveBackupFolder({
    isGroup: false,
    subject: null,
    individualFolder: "individual",
  });
  assert.equal(mapped.folder, "individual");
  const day = dayFolderFromTs(1794969000, "Asia/Hong_Kong");
  const relative = `${mapped.folder}/${day}/WA_abc.pdf`;
  assert.equal(relative, "individual/2026-11-18/WA_abc.pdf");
});
