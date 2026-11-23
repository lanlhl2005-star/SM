import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDropOnBlock,
  applyDropOnBlocksTray,
  createBlockFromGallery,
  placeImageInBlock,
  usedPaths,
} from "../public/photo-blocks.mjs";

function img(name) {
  return { relativePath: `day/${name}`, name };
}

function blocksOf(...lists) {
  return lists.map((names) => ({
    images: names.map(img),
    caption: `c:${names.join(",")}`,
  }));
}

describe("photo-blocks DnD", () => {
  it("gallery drop on empty tray creates a new block", () => {
    const blocks = [];
    const ok = applyDropOnBlocksTray(blocks, {
      kind: "gallery",
      relativePath: "day/a.jpg",
      name: "a.jpg",
    });
    assert.equal(ok, true);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0].images, [img("a.jpg")]);
  });

  it("gallery drop on existing block appends (copy from gallery)", () => {
    const blocks = blocksOf(["a.jpg"]);
    const ok = applyDropOnBlock(
      blocks,
      { kind: "gallery", relativePath: "day/b.jpg", name: "b.jpg" },
      0,
      null
    );
    assert.equal(ok, true);
    assert.equal(blocks.length, 1);
    assert.deepEqual(
      blocks[0].images.map((i) => i.name),
      ["a.jpg", "b.jpg"]
    );
  });

  it("thumb move block2 → block1 removes from source and drops empty block", () => {
    const blocks = blocksOf(["a.jpg"], ["b.jpg"]);
    const ok = applyDropOnBlock(
      blocks,
      {
        kind: "thumb",
        relativePath: "day/b.jpg",
        name: "b.jpg",
        blockIndex: 1,
        imageIndex: 0,
      },
      0,
      null
    );
    assert.equal(ok, true);
    assert.equal(blocks.length, 1, "empty source block removed");
    assert.deepEqual(
      blocks[0].images.map((i) => i.name),
      ["a.jpg", "b.jpg"]
    );
    assert.equal(usedPaths(blocks).has("day/b.jpg"), true);
    assert.equal(blocks.filter((b) => b.images.some((i) => i.name === "b.jpg")).length, 1);
  });

  it("thumb move is not a copy when hint indices are stale but path matches", () => {
    const blocks = blocksOf(["a.jpg"], ["b.jpg"]);
    const ok = placeImageInBlock(
      blocks,
      img("b.jpg"),
      0,
      null,
      { fromBlockIndex: 99, fromImageIndex: 0 } // stale → fall back to path lookup
    );
    assert.equal(ok, true);
    assert.equal(blocks.length, 1);
    assert.deepEqual(
      blocks[0].images.map((i) => i.name),
      ["a.jpg", "b.jpg"]
    );
  });

  it("thumb drop on tray extracts to a new block and clears empty source", () => {
    const blocks = blocksOf(["a.jpg", "b.jpg"]);
    const ok = applyDropOnBlocksTray(blocks, {
      kind: "thumb",
      relativePath: "day/b.jpg",
      name: "b.jpg",
      blockIndex: 0,
      imageIndex: 1,
    });
    assert.equal(ok, true);
    assert.equal(blocks.length, 2);
    assert.deepEqual(
      blocks[0].images.map((i) => i.name),
      ["a.jpg"]
    );
    assert.deepEqual(
      blocks[1].images.map((i) => i.name),
      ["b.jpg"]
    );
  });

  it("refuses second gallery insert of the same path", () => {
    const blocks = blocksOf(["a.jpg"]);
    assert.equal(
      createBlockFromGallery(blocks, "day/a.jpg", "a.jpg"),
      false
    );
    assert.equal(blocks.length, 1);
  });

  it("reorder within multi-photo block via placeImageInBlock", () => {
    const blocks = blocksOf(["a.jpg", "b.jpg", "c.jpg"]);
    const ok = placeImageInBlock(
      blocks,
      img("c.jpg"),
      0,
      0,
      { fromBlockIndex: 0, fromImageIndex: 2 }
    );
    assert.equal(ok, true);
    assert.deepEqual(
      blocks[0].images.map((i) => i.name),
      ["c.jpg", "a.jpg", "b.jpg"]
    );
  });
});
