import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertGroupName,
  defaultPhotoGroup,
  fsErrorPayload,
  listDayFolders,
  listPhotoGroups,
  listPhotos,
  photoBackupRootPath,
  resolvePhotoPath,
} from "../src/paths.js";
import { config } from "../src/config.js";

test("listPhotoGroups returns top-level backup folders including Chinese", () => {
  const groups = listPhotoGroups();
  assert.ok(groups.includes("site-memo"));
  assert.ok(groups.includes("individual"));
  assert.ok(groups.includes("LK Site Memo Sample"));
  assert.ok(groups.includes("Test 群"), `expected Test 群 in ${JSON.stringify(groups)}`);
  assert.ok(groups.includes("Archived"));
  assert.equal(groups[groups.length - 1], "Archived", "Archived sorts last");
});

test("defaultPhotoGroup prefers PHOTO_GROUP when present", () => {
  const groups = listPhotoGroups();
  const prev = config.photoGroup;
  try {
    config.photoGroup = "individual";
    assert.equal(defaultPhotoGroup(groups), "individual");
    config.photoGroup = "missing-group-xyz";
    assert.equal(defaultPhotoGroup(groups), groups[0]);
    config.photoGroup = "";
    assert.equal(defaultPhotoGroup(groups), groups[0]);
  } finally {
    config.photoGroup = prev;
  }
});

test("listDayFolders / listPhotos use group then day", () => {
  const days = listDayFolders("site-memo");
  assert.ok(days.includes("2026-11-18"));
  const photos = listPhotos("site-memo", "2026-11-18");
  assert.ok(photos.length >= 1);
  assert.match(photos[0].relativePath, /^site-memo\/2026-11-18\//);
});

test("listDayFolders for Chinese group only returns YYYY-MM-DD", () => {
  const days = listDayFolders("Test 群");
  assert.deepEqual(days, ["2026-11-18"]);
});

test("resolvePhotoPath requires group/day/file under backup root", () => {
  const full = resolvePhotoPath("site-memo/2026-11-18/IMG_chiller_plant.jpg");
  assert.ok(full.includes("IMG_chiller_plant.jpg"));
  assert.throws(() => resolvePhotoPath("2026-11-18/IMG_chiller_plant.jpg"));
  assert.throws(() => assertGroupName("../escape"));
});

test("listPhotoGroups throws with code when root missing", () => {
  const prev = config.photoBackupRoot;
  const missing = path.join(os.tmpdir(), `sm-missing-groups-${process.pid}`);
  try {
    config.photoBackupRoot = missing;
    assert.equal(photoBackupRootPath(), path.resolve(missing));
    assert.throws(
      () => listPhotoGroups(),
      (err) => {
        assert.match(String(err.message), /listPhotoGroups failed/);
        assert.equal(err.code, "ENOENT");
        const payload = fsErrorPayload(err);
        assert.equal(payload.code, "ENOENT");
        assert.ok(payload.error.includes("listPhotoGroups failed"));
        return true;
      }
    );
  } finally {
    config.photoBackupRoot = prev;
  }
});

test("listPhotoGroups keeps Unicode folder names without requiring day children", () => {
  const groups = listPhotoGroups();
  assert.ok(groups.includes("Test 群"));
  // Top-level list must not require YYYY-MM-DD children (Archived has none).
  assert.ok(groups.includes("Archived"));
  const days = listDayFolders("Archived");
  assert.deepEqual(days, []);
});
