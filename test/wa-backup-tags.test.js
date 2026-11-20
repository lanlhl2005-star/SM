import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CAPTION_WINDOW_SEC,
  buildMediaTags,
  createChatEventBuffer,
  extractNearbyCaptions,
  filterMediaByTags,
  formatSendDate,
  formatSenderNumber,
  mergeCaptionsIntoTags,
  readMediaTags,
  senderFromMessageKey,
  writeMediaTags,
} from "../src/wa-backup/tags.js";

test("formatSenderNumber strips WhatsApp JID domain and device", () => {
  assert.equal(
    formatSenderNumber("85291234567@s.whatsapp.net"),
    "85291234567"
  );
  assert.equal(
    formatSenderNumber("85291234567:12@s.whatsapp.net"),
    "85291234567"
  );
  assert.equal(formatSenderNumber(""), "unknown");
});

test("senderFromMessageKey prefers group participant", () => {
  assert.equal(
    senderFromMessageKey({
      remoteJid: "120363@g.us",
      participant: "85211112222@s.whatsapp.net",
    }),
    "85211112222"
  );
  assert.equal(
    senderFromMessageKey({ remoteJid: "85233334444@s.whatsapp.net" }),
    "85233334444"
  );
});

test("formatSendDate includes local date and time", () => {
  // 2026-11-18 10:30:00 HKT = 2026-11-18 02:30:00 UTC
  const s = formatSendDate(1794969000, "Asia/Hong_Kong");
  assert.match(s, /^2026-11-18 10:30:00$/);
});

test("extractNearbyCaptions: own caption + same-sender ±5 min window", () => {
  const mediaTs = 1_000_000;
  const sender = "85291234567";
  const events = [
    { ts: mediaTs - 60, sender, text: "before note" },
    { ts: mediaTs + 120, sender, text: "after note" },
    { ts: mediaTs + 60, sender: "other", text: "wrong sender" },
    { ts: mediaTs - CAPTION_WINDOW_SEC - 1, sender, text: "too early" },
    { ts: mediaTs + CAPTION_WINDOW_SEC + 1, sender, text: "too late" },
  ];
  const caps = extractNearbyCaptions({
    mediaTs,
    mediaSender: sender,
    mediaCaption: "on photo",
    events,
  });
  assert.deepEqual(caps, ["on photo", "before note", "after note"]);
});

test("extractNearbyCaptions dedupes case-insensitively", () => {
  const caps = extractNearbyCaptions({
    mediaTs: 100,
    mediaSender: "a",
    mediaCaption: "Hello",
    events: [{ ts: 100, sender: "a", text: "hello" }],
  });
  assert.deepEqual(caps, ["Hello"]);
});

test("createChatEventBuffer merges late text into remembered media", () => {
  const buf = createChatEventBuffer({ windowSec: 300 });
  const mediaTs = 5_000;
  buf.rememberSavedMedia({
    chatId: "chat1",
    sender: "8521",
    ts: mediaTs,
    destPath: "/tmp/x.jpg",
  });
  const hits = buf.mediaNeedingCaption({
    chatId: "chat1",
    sender: "8521",
    ts: mediaTs + 60,
    text: "late caption",
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].destPath, "/tmp/x.jpg");
  assert.equal(
    buf.mediaNeedingCaption({
      chatId: "chat1",
      sender: "other",
      ts: mediaTs + 60,
      text: "nope",
    }).length,
    0
  );
});

test("writeMediaTags / readMediaTags / mergeCaptionsIntoTags round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-tags-"));
  try {
    const media = path.join(dir, "shot.jpg");
    fs.writeFileSync(media, "x");
    const tags = buildMediaTags({
      sender: "85299998888",
      sendTs: 1794969000,
      sendDate: formatSendDate(1794969000, "Asia/Hong_Kong"),
      captions: ["plant photo"],
      mediaType: "image",
      fileName: "shot.jpg",
    });
    writeMediaTags(media, tags);
    assert.ok(fs.existsSync(`${media}.tags.json`));
    assert.ok(fs.existsSync(path.join(dir, "tags.json")));
    const read = readMediaTags(media);
    assert.equal(read.sender, "85299998888");
    assert.equal(read.caption, "plant photo");

    mergeCaptionsIntoTags(media, ["follow-up note"]);
    const again = readMediaTags(media);
    assert.deepEqual(again.captions, ["plant photo", "follow-up note"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("filterMediaByTags matches sender, date, and caption text", () => {
  const items = [
    {
      name: "a.jpg",
      day: "2026-11-18",
      tags: {
        sender: "8521111",
        sendDate: "2026-11-18 09:00:00",
        caption: "chiller",
        captions: ["chiller"],
      },
    },
    {
      name: "b.pdf",
      day: "2026-11-18",
      tags: {
        sender: "8522222",
        sendDate: "2026-11-18 15:30:00",
        caption: "delivery note",
        captions: ["delivery note"],
      },
    },
  ];
  assert.equal(filterMediaByTags(items, { sender: "2222" }).length, 1);
  assert.equal(filterMediaByTags(items, { text: "chiller" }).length, 1);
  assert.equal(filterMediaByTags(items, { date: "15:30" }).length, 1);
  assert.equal(filterMediaByTags(items, {}).length, 2);
});
