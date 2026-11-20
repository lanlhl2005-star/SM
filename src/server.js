import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  config,
  dotEnvLoad,
  envFileExists,
  uncMapSuggestion,
  uncPathRewrites,
} from "./config.js";
import { createDraftMemo } from "./create-draft.js";
import {
  createDraftUiAuth,
  resolveDraftUiPassword,
} from "./draft-ui-auth.js";
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

/**
 * Build the Draft UI Express app (no listen). Exported for auth regression tests.
 * @param {{ password?: string, publicDir?: string }} [opts]
 */
export function createApp(opts = {}) {
  const password = String(
    opts.password !== undefined ? opts.password : resolveDraftUiPassword()
  ).trim();
  const draftUiAuth = createDraftUiAuth({ password });
  const staticDir = opts.publicDir || publicDir;

  const app = express();
  // Cloudflare quick tunnel (and similar) terminate TLS and forward HTTP locally.
  // trust proxy so req.secure / cookie Secure reflect the client-facing HTTPS URL.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  // Login routes first, then hard gate, then static + APIs (all gated).
  draftUiAuth.mountLoginRoutes(app);
  app.use(draftUiAuth.middleware);
  app.use(express.static(staticDir));

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
      auth: draftUiAuth.enabled,
      authRequired: draftUiAuth.enabled,
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
      const filters = {
        sender: String(req.query.sender || ""),
        date: String(req.query.date || ""),
        text: String(req.query.text || req.query.caption || ""),
      };
      res.json({
        group,
        day,
        filters,
        photos: listPhotos(group, day, filters),
      });
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

  return { app, draftUiAuth, passwordEnabled: draftUiAuth.enabled };
}

function printStartupBanner(draftUiAuth) {
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

  console.log(`Site Memo Draft UI  http://${config.host}:${config.port}`);
  console.log(`  mode: ${config.useMock ? "MOCK" : "LIVE"} (USE_MOCK=${config.useMock})`);
  if (draftUiAuth.enabled) {
    console.log(
      `  auth: ON (login required; password length ${draftUiAuth.passwordLength})`
    );
    console.log(
      "  auth: session cookie sm_draft_auth_v2 — old cookies ignored; use /logout or ?logout=1"
    );
  } else {
    console.log(
      "  auth: OFF (no DRAFT_UI_PASSWORD — open local access; set password before tunnel)"
    );
  }
  if (!draftUiAuth.enabled && envFileExists) {
    const appliedKeys = Object.keys(dotEnvLoad.applied || {});
    const touchedAuth = appliedKeys.some((k) =>
      /^(DRAFT_UI_PASSWORD|UI_PASSWORD)$/i.test(k)
    );
    const envHasBlankPrimary =
      process.env.DRAFT_UI_PASSWORD !== undefined &&
      String(process.env.DRAFT_UI_PASSWORD).trim() === "";
    if (touchedAuth || envHasBlankPrimary) {
      console.warn(
        "  auth: .env was loaded but password resolved empty — check for a blank"
      );
      console.warn(
        "        DRAFT_UI_PASSWORD= line above the real value, or restart after edit."
      );
    }
  }
  console.log(`  photos: ${config.photoBackupRoot}`);
  console.log(`  site memos: ${config.siteMemoRoot}`);
  for (const line of uncPathRewrites) {
    console.log(`  [unc] ${line}`);
  }
  if (uncMapSuggestion && !config.useMock) {
    console.warn(`  [unc] tip: ${uncMapSuggestion}`);
  }
  if (!envFileExists) {
    console.warn("  .env: MISSING (default LIVE; mock only if USE_MOCK=true)");
  } else {
    console.log(`  .env: loaded (${dotEnvLoad.path})`);
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
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  ensureRoots();
  const { app, draftUiAuth } = createApp();
  app.listen(config.port, config.host, () => {
    printStartupBanner(draftUiAuth);
  });
}
