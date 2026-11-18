import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUncHostAllowlist,
  formatUncHostAllowlist,
  mergeUncHosts,
  parseUncHostAllowlist,
  uncHostFromPath,
  uncHostsFromPaths,
} from "../src/unc-allowlist.js";

test("uncHostFromPath extracts host from standard UNC", () => {
  assert.equal(
    uncHostFromPath(
      "\\\\Server\\Share\\Sang\\project\\new project 2026\\cmi 火炭 MVAC\\Group_photo_backup"
    ),
    "Server"
  );
  assert.equal(uncHostFromPath("//Server/Share/foo"), "Server");
  assert.equal(uncHostFromPath("\\\\server\\Share\\x"), "server");
});

test("uncHostFromPath handles DOS device UNC and non-UNC", () => {
  assert.equal(uncHostFromPath("\\\\?\\UNC\\Server\\Share\\a"), "Server");
  assert.equal(uncHostFromPath("\\\\.\\UNC\\Filesrv\\Share"), "Filesrv");
  assert.equal(uncHostFromPath("S:\\Sang\\Group_photo_backup"), null);
  assert.equal(uncHostFromPath("C:\\Users\\me"), null);
  assert.equal(uncHostFromPath(""), null);
});

test("allowlist parse/format uses backslash separators", () => {
  assert.deepEqual(parseUncHostAllowlist("Server"), ["Server"]);
  assert.deepEqual(parseUncHostAllowlist("Server\\filesrv"), [
    "Server",
    "filesrv",
  ]);
  assert.equal(formatUncHostAllowlist(["Server", "filesrv"]), "Server\\filesrv");
});

test("mergeUncHosts is case-insensitive and keeps first casing", () => {
  assert.deepEqual(mergeUncHosts(["Server"], ["server"], ["FILESRV"]), [
    "Server",
    "FILESRV",
  ]);
});

test("uncHostsFromPaths collects unique hosts from roots", () => {
  const hosts = uncHostsFromPaths([
    "\\\\Server\\Share\\a\\Group_photo_backup",
    "\\\\Server\\Share\\a\\Site Memo",
    "S:\\mapped\\path",
    "\\\\Other\\Share\\x",
  ]);
  assert.deepEqual(hosts, ["Server", "Other"]);
});

test("applyUncHostAllowlist merges into process.env", () => {
  const prev = process.env.NODE_UNC_HOST_ALLOWLIST;
  try {
    process.env.NODE_UNC_HOST_ALLOWLIST = "Existing";
    const { hosts } = applyUncHostAllowlist(["Server"]);
    assert.ok(hosts.includes("Existing"));
    assert.ok(hosts.includes("Server"));
    assert.equal(
      process.env.NODE_UNC_HOST_ALLOWLIST,
      formatUncHostAllowlist(hosts)
    );
  } finally {
    if (prev === undefined) delete process.env.NODE_UNC_HOST_ALLOWLIST;
    else process.env.NODE_UNC_HOST_ALLOWLIST = prev;
  }
});
