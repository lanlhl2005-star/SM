import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moveFile } from "../src/wa-backup/move-file.js";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-move-"));
}

test("moveFile renames on the same volume", async () => {
  const root = makeTempRoot();
  const src = path.join(root, "src.jpg");
  const dest = path.join(root, "out", "dest.jpg");
  fs.writeFileSync(src, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const result = await moveFile(src, dest);

  assert.equal(result.method, "rename");
  assert.equal(fs.existsSync(src), false);
  assert.deepEqual(fs.readFileSync(dest), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

test("moveFile falls back to copy on EXDEV and preserves Unicode paths", async () => {
  const root = makeTempRoot();
  const srcDir = path.join(root, "local-tmp");
  const destDir = path.join(root, "cmi 火炭 MVAC", "Group_photo_backup", "unmapped", "2026-11-18");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const src = path.join(srcDir, "WA_abcd1234.jpg");
  const dest = path.join(destDir, "火炭_group_photo.jpg");
  const payload = Buffer.from("unicode-path-payload-火炭");
  fs.writeFileSync(src, payload);

  let renameCalls = 0;
  const result = await moveFile(src, dest, {
    rename: async (from, to) => {
      renameCalls += 1;
      if (renameCalls === 1) {
        const err = new Error(
          `cross-device link not permitted, rename '${from}' -> '${to}'`
        );
        err.code = "EXDEV";
        throw err;
      }
      // Second rename is staging → dest on the destination volume.
      await fs.promises.rename(from, to);
    },
  });

  assert.equal(result.method, "copy");
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.existsSync(dest), true);
  assert.deepEqual(fs.readFileSync(dest), payload);
  assert.match(dest, /火炭_group_photo\.jpg$/);
  assert.match(path.dirname(dest), /cmi 火炭 MVAC/);
});

test("moveFile falls back on EPERM (Windows UNC quirk)", async () => {
  const root = makeTempRoot();
  const src = path.join(root, "a.bin");
  const dest = path.join(root, "share", "b.bin");
  fs.writeFileSync(src, "x");

  let first = true;
  await moveFile(src, dest, {
    rename: async (from, to) => {
      if (first) {
        first = false;
        const err = new Error("operation not permitted");
        err.code = "EPERM";
        throw err;
      }
      await fs.promises.rename(from, to);
    },
  });

  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.readFileSync(dest, "utf8"), "x");
});
