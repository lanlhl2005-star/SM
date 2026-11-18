import test from "node:test";
import assert from "node:assert/strict";
import {
  INDIVIDUAL_FOLDER,
  resolveBackupFolder,
} from "../src/wa-backup/group-map.js";

test("group chats use sanitized live subject as folder", () => {
  const r = resolveBackupFolder({
    isGroup: true,
    subject: "CMI 火炭 Site Memo",
  });
  assert.equal(r.folder, "CMI 火炭 Site Memo");
  assert.match(r.reason, /group subject/);
});

test("strips illegal Windows/UNC chars from group subject", () => {
  const r = resolveBackupFolder({
    isGroup: true,
    subject: 'Site Memo: "A/B" <draft>?',
  });
  assert.equal(r.folder, "Site Memo A B draft");
});

test("1:1 chats use individual folder", () => {
  const r = resolveBackupFolder({ isGroup: false, subject: null });
  assert.equal(r.folder, INDIVIDUAL_FOLDER);
  assert.match(r.reason, /1:1/);
});

test("empty group subject falls back to individual", () => {
  const r = resolveBackupFolder({ isGroup: true, subject: "   " });
  assert.equal(r.folder, "individual");
});

test("does not map by keyword aliases", () => {
  const r = resolveBackupFolder({
    isGroup: true,
    subject: "LK site-memo photos",
  });
  assert.equal(r.folder, "LK site-memo photos");
  assert.notEqual(r.folder, "site-memo");
  assert.notEqual(r.folder, "unmapped");
});
