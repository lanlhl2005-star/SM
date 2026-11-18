import test from "node:test";
import assert from "node:assert/strict";
import { mapSubjectToGroup } from "../src/wa-backup/group-map.js";

const groupMap = {
  "site-memo": {
    matchNames: ["site memo", "site-memo", "Site Memo"],
  },
  "material-delivery": {
    matchNames: ["material delivery", "material-delivery"],
  },
  internal: {
    matchNames: ["internal", "internal communication"],
  },
  "bim-coordination": {
    matchNames: ["bim", "bim coordination", "BIM"],
  },
};

test("maps exact and fuzzy group subjects", () => {
  assert.equal(mapSubjectToGroup("Site Memo", groupMap).group, "site-memo");
  assert.equal(
    mapSubjectToGroup("LK site-memo photos", groupMap).group,
    "site-memo"
  );
  assert.equal(
    mapSubjectToGroup("Material Delivery", groupMap).group,
    "material-delivery"
  );
  assert.equal(
    mapSubjectToGroup("BIM coordination", groupMap).group,
    "bim-coordination"
  );
});

test("falls back when unmatched", () => {
  const r = mapSubjectToGroup("Random Chat", groupMap, "unmapped");
  assert.equal(r.group, "unmapped");
  assert.match(r.reason, /unmatched/);
});
