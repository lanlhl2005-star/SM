import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, envFileExists } from "./config.js";
import { createDraftMemo } from "./create-draft.js";
import { formatDocSeq, formatFolderNn, nextMemoSequence } from "./memo-number.js";
import {
  defaultPhotoGroup,
  ensureRoots,
  fsErrorPayload,
  listDayFolders,
  listPhotoGroups,
  listPhotos,
  photoBackupRootPath,
  resolvePhotoPath,
} from "./paths.js";

function safeListPhotoGroups() {
  try {
    return { groups: listPhotoGroups(), listError: null };
  } catch (err) {
    return { groups: [], listError: fsErrorPayload(err) };
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

if (!envFileExists) {
  console.warn("");
  console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.warn("  WARNING: no .env file found in the repo root.");
  console.warn("  Default is LIVE (useMock=false) using config/default.json UNC.");
  console.warn("  Mock fixtures are used ONLY when USE_MOCK=true is set.");
  console.warn("  On Windows: copy .env.example to .env (USE_MOCK=false) and");
  console.warn("  restart so Draft UI shows LIVE + the live Group_photo_backup.");
  console.warn("  Offline/cloud smoke: set USE_MOCK=true explicitly.");
  console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.warn("");
}

ensureRoots();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  const seq = nextMemoSequence();
  const { groups, listError } = safeListPhotoGroups();
  res.json({
    ok: !listError,
    useMock: config.useMock,
    photoBackupRoot: config.photoBackupRoot,
    siteMemoRoot: config.siteMemoRoot,
    photoGroup: config.photoGroup || null,
    defaultGroup: listError ? null : defaultPhotoGroup(groups),
    groups,
    listError,
    nextMemo: {
      folder_nn: formatFolderNn(seq),
      memo_number: formatDocSeq(seq),
    },
  });
});

app.get("/api/groups", (_req, res) => {
  try {
    const groups = listPhotoGroups();
    res.json({
      groups,
      root: photoBackupRootPath(),
      defaultGroup: defaultPhotoGroup(groups),
      preferredGroup: config.photoGroup || null,
    });
  } catch (err) {
    res.status(500).json(fsErrorPayload(err));
  }
});

app.get("/api/days", (req, res) => {
  try {
    const group = String(req.query.group || "");
    res.json({
      group,
      days: listDayFolders(group),
      root: path.join(photoBackupRootPath(), group),
    });
  } catch (err) {
    const status = err?.code === "ENOENT" || err?.code === "EACCES" ? 500 : 400;
    res.status(status).json(fsErrorPayload(err));
  }
});

app.get("/api/photos", (req, res) => {
  try {
    const group = String(req.query.group || "");
    const day = String(req.query.day || "");
    res.json({ group, day, photos: listPhotos(group, day) });
  } catch (err) {
    res.status(400).json(fsErrorPayload(err));
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
  const { groups, listError } = safeListPhotoGroups();
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
      preferredGroup: config.photoGroup || null,
      defaultGroup: listError ? null : defaultPhotoGroup(groups),
      groups,
      listError,
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
  console.log(`  mode: ${config.useMock ? "MOCK" : "LIVE"} (USE_MOCK=${config.useMock})`);
  console.log(`  photos: ${config.photoBackupRoot}`);
  console.log(`  site memos: ${config.siteMemoRoot}`);
  if (!envFileExists) {
    console.warn("  .env: MISSING (default LIVE; mock only if USE_MOCK=true)");
  }
  const { groups, listError } = safeListPhotoGroups();
  if (listError) {
    console.warn(
      `  groups: ERROR ${listError.error}` +
        (listError.code ? ` (${listError.code})` : "")
    );
  } else {
    console.log(
      `  groups: ${groups.length ? groups.join(", ") : "(none yet)"}` +
        (config.photoGroup ? ` (PHOTO_GROUP default=${config.photoGroup})` : "")
    );
  }
});
