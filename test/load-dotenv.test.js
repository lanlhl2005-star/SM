import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDotEnvText,
  parseDotEnvLine,
} from "../src/load-dotenv.js";

test("parseDotEnvLine supports export and quotes", () => {
  assert.deepEqual(parseDotEnvLine("FOO=bar"), { key: "FOO", value: "bar" });
  assert.deepEqual(parseDotEnvLine("export FOO=bar"), {
    key: "FOO",
    value: "bar",
  });
  assert.deepEqual(parseDotEnvLine('FOO="bar baz"'), {
    key: "FOO",
    value: "bar baz",
  });
  assert.equal(parseDotEnvLine("# comment"), null);
  assert.equal(parseDotEnvLine(""), null);
});

test("empty DRAFT_UI_PASSWORD= then real value: later wins", () => {
  /** @type {Record<string, string | undefined>} */
  const env = {};
  applyDotEnvText(
    ["DRAFT_UI_PASSWORD=", "DRAFT_UI_PASSWORD=27988210", "USE_MOCK=false"].join(
      "\n"
    ),
    env
  );
  assert.equal(env.DRAFT_UI_PASSWORD, "27988210");
  assert.equal(env.USE_MOCK, "false");
});

test("empty process env placeholder is overwritten by .env value", () => {
  /** @type {Record<string, string | undefined>} */
  const env = { DRAFT_UI_PASSWORD: "" };
  applyDotEnvText("DRAFT_UI_PASSWORD=from-file\n", env);
  assert.equal(env.DRAFT_UI_PASSWORD, "from-file");
});

test("non-empty process env is preserved", () => {
  /** @type {Record<string, string | undefined>} */
  const env = { DRAFT_UI_PASSWORD: "already-set" };
  applyDotEnvText("DRAFT_UI_PASSWORD=from-file\n", env);
  assert.equal(env.DRAFT_UI_PASSWORD, "already-set");
});

test("BOM-prefixed key still loads", () => {
  /** @type {Record<string, string | undefined>} */
  const env = {};
  applyDotEnvText("\uFEFFDRAFT_UI_PASSWORD=secret\n", env);
  assert.equal(env.DRAFT_UI_PASSWORD, "secret");
});
