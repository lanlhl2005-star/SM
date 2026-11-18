import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGroupName,
  defaultPhotoGroup,
  listDayFolders,
  listPhotoGroups,
  listPhotos,
  resolvePhotoPath,
} from "../src/paths.js";
import { config } from "../src/config.js";

test("listPhotoGroups returns top-level backup folders", () => {
  const groups = listPhotoGroups();
  assert.ok(groups.includes("site-memo"));
  assert.ok(groups.includes("individual"));
  assert.ok(groups.includes("LK Site Memo Sample"));
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

test("resolvePhotoPath requires group/day/file under backup root", () => {
  const full = resolvePhotoPath("site-memo/2026-11-18/IMG_chiller_plant.jpg");
  assert.ok(full.includes("IMG_chiller_plant.jpg"));
  assert.throws(() => resolvePhotoPath("2026-11-18/IMG_chiller_plant.jpg"));
  assert.throws(() => assertGroupName("../escape"));
});
