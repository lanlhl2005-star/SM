import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, siteMemoPhotoRoot } from "./config.js";
import { createDraftMemo } from "./create-draft.js";
import { formatDocSeq, formatFolderNn, nextMemoSequence } from "./memo-number.js";
import {
  ensureRoots,
  listDayFolders,
  listPhotos,
  resolvePhotoPath,
} from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

ensureRoots();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  const seq = nextMemoSequence();
  res.json({
    ok: true,
    useMock: config.useMock,
    photoBackupRoot: config.photoBackupRoot,
    siteMemoRoot: config.siteMemoRoot,
    photoGroup: config.photoGroup,
    nextMemo: {
      folder_nn: formatFolderNn(seq),
      memo_number: formatDocSeq(seq),
    },
  });
});

app.get("/api/days", (_req, res) => {
  try {
    res.json({ days: listDayFolders(), root: siteMemoPhotoRoot() });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/photos", (req, res) => {
  try {
    const day = String(req.query.day || "");
    res.json({ day, photos: listPhotos(day) });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get("/api/photo-file", (req, res) => {
  try {
    const rel = String(req.query.path || "");
    const full = resolvePhotoPath(rel);
    res.sendFile(full);
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

app.get("/api/defaults", (_req, res) => {
  const seq = nextMemoSequence();
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  res.json({
    projectLocked: config.projectLocked,
    date: `${dd}/${mm}/${yyyy}`,
    next: {
      sequence: seq,
      folder_nn: formatFolderNn(seq),
      memo_number: formatDocSeq(seq),
      folder_preview: `SM-${formatFolderNn(seq)} {short subject} (Draft)`,
    },
    paths: {
      photoBackupRoot: config.photoBackupRoot,
      siteMemoRoot: config.siteMemoRoot,
      useMock: config.useMock,
    },
  });
});

app.post("/api/drafts", (req, res) => {
  try {
    const result = createDraftMemo(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get("/api/open-hint", (req, res) => {
  const p = String(req.query.path || "");
  if (!p || !fs.existsSync(p)) {
    return res.status(404).json({ error: "Path not found" });
  }
  res.json({ path: p, exists: true });
});

app.listen(config.port, config.host, () => {
  console.log(`Site Memo Draft UI  http://${config.host}:${config.port}`);
  console.log(`  USE_MOCK=${config.useMock}`);
  console.log(`  photos: ${config.photoBackupRoot}`);
  console.log(`  site memos: ${config.siteMemoRoot}`);
});
