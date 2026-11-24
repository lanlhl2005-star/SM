import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildMsgKey } from "../src/wa-backup/media.js";
import {
  deleteBackupPaths,
  extractRevokeTargetKey,
  findStateKeysForRevoke,
  isRevokeProtocolMessage,
  isRevokeUpdate,
  pathsForStateEntry,
  resolveSafeBackupPath,
  revokeAndDeleteBackup,
  STUB_ADMIN_REVOKE,
  STUB_REVOKE,
} from "../src/wa-backup/revoke.js";

test("isRevokeUpdate detects stub REVOKE and ADMIN_REVOKE", () => {
  assert.equal(
    isRevokeUpdate({
      key: { id: "abc" },
      update: { messageStubType: STUB_REVOKE, message: null },
    }),
    true
  );
  assert.equal(
    isRevokeUpdate({
      key: { id: "abc" },
      update: { messageStubType: STUB_ADMIN_REVOKE },
    }),
    true
  );
  assert.equal(
    isRevokeUpdate({
      key: { id: "abc" },
      update: { messageStubType: "REVOKE" },
    }),
    true
  );
  assert.equal(
    isRevokeUpdate({ key: { id: "abc" }, update: { status: 3 } }),
    false
  );
});

test("isRevokeProtocolMessage detects protocolMessage REVOKE", () => {
  assert.equal(
    isRevokeProtocolMessage({
      key: { remoteJid: "g@g.us", id: "rev1" },
      message: {
        protocolMessage: {
          type: 0,
          key: { remoteJid: "g@g.us", id: "orig1", participant: "1@s.whatsapp.net" },
        },
      },
    }),
    true
  );
  assert.equal(
    isRevokeProtocolMessage({
      message: { imageMessage: { mimetype: "image/jpeg" } },
    }),
    false
  );
});

test("extractRevokeTargetKey prefers protocolMessage.key", () => {
  const key = extractRevokeTargetKey({
    key: {
      remoteJid: "120363@g.us",
      id: "revokeMsgId",
      fromMe: false,
      participant: "852111@s.whatsapp.net",
    },
    message: {
      protocolMessage: {
        type: 0,
        key: {
          remoteJid: "120363@g.us",
          id: "originalMediaId",
          fromMe: false,
          participant: "852111@s.whatsapp.net",
        },
      },
    },
  });
  assert.equal(key.id, "originalMediaId");
  assert.equal(key.remoteJid, "120363@g.us");
  assert.equal(key.participant, "852111@s.whatsapp.net");
});

test("extractRevokeTargetKey from messages.update uses swapped id", () => {
  const key = extractRevokeTargetKey({
    key: {
      remoteJid: "120363@g.us",
      id: "originalMediaId",
      fromMe: false,
      participant: "852111@s.whatsapp.net",
    },
    update: { messageStubType: STUB_REVOKE, message: null },
  });
  assert.equal(key.id, "originalMediaId");
  assert.equal(buildMsgKey(key).includes("originalMediaId"), true);
});

test("pathsForStateEntry merges dest and dests", () => {
  assert.deepEqual(
    pathsForStateEntry({
      dest: "/a/one.jpg",
      dests: ["/a/one.jpg", "/a/two.pdf"],
    }),
    ["/a/one.jpg", "/a/two.pdf"]
  );
  assert.deepEqual(pathsForStateEntry({ dest: "/only.jpg" }), ["/only.jpg"]);
  assert.deepEqual(pathsForStateEntry(null), []);
});

test("resolveSafeBackupPath allows only under root", () => {
  const root = path.join(os.tmpdir(), "wa-revoke-root-safe");
  fs.mkdirSync(root, { recursive: true });
  const inside = path.join(root, "Group", "2026-11-24", "pic.jpg");
  assert.equal(resolveSafeBackupPath(inside, root), path.resolve(inside));
  assert.equal(
    resolveSafeBackupPath(path.join(root, "..", "outside.jpg"), root),
    null
  );
  assert.equal(resolveSafeBackupPath(root, root), null);
  assert.equal(resolveSafeBackupPath("/etc/passwd", root), null);
});

test("findStateKeysForRevoke exact + participant fallback", () => {
  const remoteJid = "120363@g.us";
  const id = "MSGID1";
  const exact = buildMsgKey({
    remoteJid,
    id,
    fromMe: false,
    participant: "852111@s.whatsapp.net",
  });
  const otherParticipant = buildMsgKey({
    remoteJid,
    id,
    fromMe: false,
    participant: "852999@s.whatsapp.net",
  });
  const state = {
    messages: {
      [exact]: { status: "saved", dest: "/x/a.jpg" },
      [otherParticipant]: { status: "saved", dest: "/x/b.jpg" },
      "other|ZZ|0|": { status: "saved", dest: "/x/c.jpg" },
    },
  };
  const hits = findStateKeysForRevoke(state, {
    remoteJid,
    id,
    fromMe: false,
    participant: "852111@s.whatsapp.net",
  });
  assert.ok(hits.includes(exact));
  assert.ok(hits.includes(otherParticipant));
  assert.equal(hits.includes("other|ZZ|0|"), false);
});

test("revokeAndDeleteBackup deletes media + sidecar under root only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wa-revoke-del-"));
  const dayDir = path.join(root, "CMI group", "2026-11-24");
  fs.mkdirSync(dayDir, { recursive: true });
  const media = path.join(dayDir, "photo.jpg");
  const sidecar = `${media}.tags.json`;
  const outside = path.join(os.tmpdir(), `wa-revoke-outside-${Date.now()}.jpg`);
  fs.writeFileSync(media, "img");
  fs.writeFileSync(sidecar, JSON.stringify({ sender: "1" }));
  fs.writeFileSync(
    path.join(dayDir, "tags.json"),
    JSON.stringify({ files: { "photo.jpg": { sender: "1" }, keep: { x: 1 } } })
  );
  fs.writeFileSync(outside, "nope");

  const msgKey = buildMsgKey({
    remoteJid: "g@g.us",
    id: "ID1",
    fromMe: false,
    participant: "p@s.whatsapp.net",
  });
  const state = {
    messages: {
      [msgKey]: {
        status: "saved",
        dest: media,
        dests: [media, outside],
      },
    },
  };

  const result = revokeAndDeleteBackup({
    state,
    targetKey: {
      remoteJid: "g@g.us",
      id: "ID1",
      fromMe: false,
      participant: "p@s.whatsapp.net",
    },
    photoBackupRoot: root,
  });

  assert.equal(result.noMapping, false);
  assert.ok(result.deleted.includes(path.resolve(media)));
  assert.ok(result.skipped.includes(outside));
  assert.equal(fs.existsSync(media), false);
  assert.equal(fs.existsSync(sidecar), false);
  assert.equal(fs.existsSync(outside), true);
  assert.equal(state.messages[msgKey].status, "revoked");

  const index = JSON.parse(
    fs.readFileSync(path.join(dayDir, "tags.json"), "utf8")
  );
  assert.equal(index.files["photo.jpg"], undefined);
  assert.deepEqual(index.files.keep, { x: 1 });

  fs.unlinkSync(outside);
  fs.rmSync(root, { recursive: true, force: true });
});

test("deleteBackupPaths multi-file support", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wa-revoke-multi-"));
  const a = path.join(root, "a.jpg");
  const b = path.join(root, "b.pdf");
  fs.writeFileSync(a, "a");
  fs.writeFileSync(b, "b");
  const result = deleteBackupPaths({
    paths: [a, b],
    photoBackupRoot: root,
  });
  assert.equal(result.deleted.length, 2);
  assert.equal(fs.existsSync(a), false);
  assert.equal(fs.existsSync(b), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("revoke with no mapping is a no-op", () => {
  const result = revokeAndDeleteBackup({
    state: { messages: {} },
    targetKey: {
      remoteJid: "g@g.us",
      id: "missing",
      fromMe: false,
      participant: "",
    },
    photoBackupRoot: os.tmpdir(),
  });
  assert.equal(result.noMapping, true);
  assert.deepEqual(result.deleted, []);
});
