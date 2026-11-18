import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNetUseOutput,
  preferMappedDrivePath,
  rewriteUncPrefix,
  rewriteUncUsingMappings,
  uncMappedDriveHint,
  uncShareRoot,
} from "../src/unc-mapped-drive.js";

test("uncShareRoot extracts \\\\Server\\Share", () => {
  assert.equal(
    uncShareRoot(
      "\\\\Server\\Share\\Sang\\project\\new project 2026\\cmi 火炭 MVAC\\Group_photo_backup"
    ),
    "\\\\Server\\Share"
  );
  assert.equal(uncShareRoot("S:\\Sang\\Group_photo_backup"), null);
});

test("rewriteUncPrefix maps share root to drive letter", () => {
  assert.equal(
    rewriteUncPrefix(
      "\\\\Server\\Share\\Sang\\project\\Group_photo_backup",
      "\\\\Server\\Share",
      "S:"
    ),
    "S:\\Sang\\project\\Group_photo_backup"
  );
  assert.equal(
    rewriteUncPrefix("\\\\Server\\Share", "\\\\Server\\Share", "s"),
    "S:\\"
  );
});

test("parseNetUseOutput reads drive and remote", () => {
  const text = `
Status       Local     Remote                    Network
-------------------------------------------------------------------------------
OK           S:        \\\\Server\\Share            Microsoft Windows Network
Unavailable  Z:        \\\\Other\\Data              Microsoft Windows Network
The command completed successfully.
`;
  assert.deepEqual(parseNetUseOutput(text), [
    { drive: "S:", remote: "\\\\Server\\Share" },
    { drive: "Z:", remote: "\\\\Other\\Data" },
  ]);
});

test("rewriteUncUsingMappings picks longest matching remote", () => {
  const result = rewriteUncUsingMappings(
    "\\\\Server\\Share\\Sang\\Group_photo_backup",
    [
      { drive: "Z:", remote: "\\\\Other\\Data" },
      { drive: "S:", remote: "\\\\Server\\Share" },
    ]
  );
  assert.equal(result.mapped, true);
  assert.equal(result.path, "S:\\Sang\\Group_photo_backup");
  assert.equal(result.drive, "S:");
});

test("preferMappedDrivePath honors SHARE_DRIVE without net use", () => {
  const prev = process.env.SHARE_DRIVE;
  const platform = process.platform;
  try {
    process.env.SHARE_DRIVE = "S:";
    // Force win32 behavior for the rewrite helpers by calling rewrite path via opts.
    const result = preferMappedDrivePath(
      "\\\\Server\\Share\\Sang\\Site Memo",
      { preferredDrive: "S:", mappings: [] }
    );
    assert.equal(result.mapped, true);
    assert.equal(result.path, "S:\\Sang\\Site Memo");
    assert.equal(result.via, "SHARE_DRIVE");
  } finally {
    if (prev === undefined) delete process.env.SHARE_DRIVE;
    else process.env.SHARE_DRIVE = prev;
    assert.equal(process.platform, platform);
  }
});

test("uncMappedDriveHint mentions stock Node and net use", () => {
  const hint = uncMappedDriveHint("\\\\Server\\Share\\Sang\\x");
  assert.match(hint, /net use S: \\\\Server\\Share/);
  assert.match(hint, /SHARE_DRIVE=S:/);
  assert.match(hint, /Program Files\\nodejs/);
});
