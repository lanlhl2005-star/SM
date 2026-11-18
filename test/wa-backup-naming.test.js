import test from "node:test";
import assert from "node:assert/strict";
import {
  dayFolderFromTs,
  nextAvailableFileName,
  resolveFileStem,
  sanitizeStem,
} from "../src/wa-backup/naming.js";

test("sanitizeStem strips illegal Windows chars", () => {
  assert.equal(sanitizeStem('Photo: "stair"/clash?'), "Photo stair clash");
  assert.equal(sanitizeStem(""), "");
});

test("resolveFileStem prefers caption then filename", () => {
  assert.equal(
    resolveFileStem({
      caption: "Chiller plant",
      originalFileName: "IMG_001.jpg",
      shortMsgId: "abc12345",
    }),
    "Chiller plant"
  );
  assert.equal(
    resolveFileStem({
      caption: null,
      originalFileName: "delivery_note.png",
      shortMsgId: "abc12345",
    }),
    "delivery_note"
  );
  assert.equal(
    resolveFileStem({
      caption: null,
      originalFileName: null,
      shortMsgId: "abc12345",
    }),
    "WA_abc12345"
  );
});

test("nextAvailableFileName avoids collisions", () => {
  const existing = new Set(["photo.jpg", "photo_2.jpg"]);
  assert.equal(
    nextAvailableFileName("photo", ".jpg", (n) => existing.has(n)),
    "photo_3.jpg"
  );
});

test("dayFolderFromTs uses Asia/Hong_Kong", () => {
  // 2026-11-18 02:00 UTC → still 2026-11-18 in HKT (UTC+8)
  assert.equal(dayFolderFromTs(1794967200, "Asia/Hong_Kong"), "2026-11-18");
});
