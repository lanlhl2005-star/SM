/**
 * Pure helpers for Draft UI photo_blocks[] mutations (gallery / thumb / block DnD).
 * Kept free of DOM so Node tests can cover move-vs-copy and empty-block cleanup.
 */

/**
 * @typedef {{ relativePath: string, name: string }} BlockImage
 * @typedef {{ images: BlockImage[], caption: string }} PhotoBlock
 * @typedef {{ kind: 'gallery'|'thumb'|'block', relativePath?: string, name?: string, blockIndex?: number, imageIndex?: number }} DragPayload
 */

/**
 * @param {PhotoBlock[]} blocks
 * @param {string} relativePath
 * @returns {{ blockIndex: number, imageIndex: number } | null}
 */
export function findImageLocation(blocks, relativePath) {
  for (let bi = 0; bi < blocks.length; bi++) {
    const ii = blocks[bi].images.findIndex((img) => img.relativePath === relativePath);
    if (ii >= 0) return { blockIndex: bi, imageIndex: ii };
  }
  return null;
}

/**
 * @param {PhotoBlock[]} blocks
 * @returns {Set<string>}
 */
export function usedPaths(blocks) {
  const used = new Set();
  for (const b of blocks) {
    for (const img of b.images) used.add(img.relativePath);
  }
  return used;
}

/**
 * @param {BlockImage[]} images
 * @returns {string}
 */
export function defaultCaptionFor(images) {
  if (images.length === 1) {
    return `Photo of ${images[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")}`;
  }
  return `Photos (${images.length})`;
}

/**
 * Remove empty blocks. Prefer removing empties after a move.
 * @param {PhotoBlock[]} blocks
 */
export function removeEmptyBlocks(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!blocks[i].images.length) blocks.splice(i, 1);
  }
}

/**
 * Move or insert an image into a target block.
 * If the image already lives in some block, it is **moved** (not copied).
 * Empty source blocks are removed.
 *
 * @param {PhotoBlock[]} blocks
 * @param {BlockImage} img
 * @param {number} toBlockIndex
 * @param {number | null | undefined} toImageIndex append when null/undefined
 * @param {{ fromBlockIndex?: number, fromImageIndex?: number }} [hint] preferred source indices from drag payload
 * @returns {boolean}
 */
export function placeImageInBlock(blocks, img, toBlockIndex, toImageIndex, hint) {
  if (!img?.relativePath || toBlockIndex < 0 || toBlockIndex >= blocks.length) {
    return false;
  }

  let fromB =
    hint && Number.isInteger(hint.fromBlockIndex) ? hint.fromBlockIndex : null;
  let fromI =
    hint && Number.isInteger(hint.fromImageIndex) ? hint.fromImageIndex : null;

  if (
    fromB == null ||
    fromI == null ||
    fromB < 0 ||
    fromB >= blocks.length ||
    fromI < 0 ||
    fromI >= blocks[fromB].images.length ||
    blocks[fromB].images[fromI].relativePath !== img.relativePath
  ) {
    const loc = findImageLocation(blocks, img.relativePath);
    if (loc) {
      fromB = loc.blockIndex;
      fromI = loc.imageIndex;
    } else {
      fromB = null;
      fromI = null;
    }
  }

  let targetBlock = toBlockIndex;
  let targetIndex =
    toImageIndex == null || toImageIndex < 0
      ? blocks[targetBlock].images.length
      : toImageIndex;

  if (fromB != null && fromI != null) {
    if (fromB === targetBlock && (fromI === targetIndex || fromI === targetIndex - 1)) {
      return false;
    }
    const [moved] = blocks[fromB].images.splice(fromI, 1);
    if (fromB === targetBlock && fromI < targetIndex) targetIndex -= 1;
    if (!blocks[fromB].images.length) {
      blocks.splice(fromB, 1);
      if (fromB < targetBlock) targetBlock -= 1;
      if (targetBlock < 0 || targetBlock >= blocks.length) {
        blocks.push({
          images: [moved],
          caption: defaultCaptionFor([moved]),
        });
        return true;
      }
    }
    const block = blocks[targetBlock];
    const clamped = Math.max(0, Math.min(targetIndex, block.images.length));
    block.images.splice(clamped, 0, moved);
    removeEmptyBlocks(blocks);
    return true;
  }

  if (usedPaths(blocks).has(img.relativePath)) return false;
  const block = blocks[targetBlock];
  const clamped = Math.max(0, Math.min(targetIndex, block.images.length));
  block.images.splice(clamped, 0, {
    relativePath: img.relativePath,
    name: img.name,
  });
  return true;
}

/**
 * Create a new photo block from a gallery photo.
 * @param {PhotoBlock[]} blocks
 * @param {string} relativePath
 * @param {string} [name]
 * @param {number} [atIndex]
 * @returns {boolean}
 */
export function createBlockFromGallery(blocks, relativePath, name, atIndex) {
  if (!relativePath || usedPaths(blocks).has(relativePath)) return false;
  const img = {
    relativePath,
    name: name || relativePath.split(/[/\\]/).pop() || relativePath,
  };
  const block = {
    images: [img],
    caption: defaultCaptionFor([img]),
  };
  if (atIndex == null || atIndex < 0 || atIndex > blocks.length) {
    blocks.push(block);
  } else {
    blocks.splice(atIndex, 0, block);
  }
  return true;
}

/**
 * Pull a thumb out into its own new block at the end of the tray.
 * @param {PhotoBlock[]} blocks
 * @param {string} relativePath
 * @param {{ fromBlockIndex?: number, fromImageIndex?: number }} [hint]
 * @returns {boolean}
 */
export function extractThumbToNewBlock(blocks, relativePath, hint) {
  let fromB =
    hint && Number.isInteger(hint.fromBlockIndex) ? hint.fromBlockIndex : null;
  let fromI =
    hint && Number.isInteger(hint.fromImageIndex) ? hint.fromImageIndex : null;
  if (
    fromB == null ||
    fromI == null ||
    fromB < 0 ||
    fromB >= blocks.length ||
    fromI < 0 ||
    fromI >= blocks[fromB].images.length ||
    blocks[fromB].images[fromI].relativePath !== relativePath
  ) {
    const loc = findImageLocation(blocks, relativePath);
    if (!loc) return false;
    fromB = loc.blockIndex;
    fromI = loc.imageIndex;
  }
  const [img] = blocks[fromB].images.splice(fromI, 1);
  if (!blocks[fromB].images.length) blocks.splice(fromB, 1);
  blocks.push({
    images: [img],
    caption: defaultCaptionFor([img]),
  });
  return true;
}

/**
 * @param {PhotoBlock[]} blocks
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {boolean}
 */
export function moveBlockTo(blocks, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= blocks.length ||
    toIndex >= blocks.length
  ) {
    return false;
  }
  const [block] = blocks.splice(fromIndex, 1);
  blocks.splice(toIndex, 0, block);
  return true;
}

/**
 * Apply a drop onto a specific block.
 * @param {PhotoBlock[]} blocks
 * @param {DragPayload | null} drag
 * @param {number} blockIndex
 * @param {number | null | undefined} beforeImageIndex
 * @returns {boolean}
 */
export function applyDropOnBlock(blocks, drag, blockIndex, beforeImageIndex) {
  if (!drag) return false;
  if (drag.kind === "gallery") {
    return placeImageInBlock(
      blocks,
      { relativePath: drag.relativePath, name: drag.name },
      blockIndex,
      beforeImageIndex
    );
  }
  if (drag.kind === "thumb") {
    return placeImageInBlock(
      blocks,
      { relativePath: drag.relativePath, name: drag.name },
      blockIndex,
      beforeImageIndex,
      { fromBlockIndex: drag.blockIndex, fromImageIndex: drag.imageIndex }
    );
  }
  if (drag.kind === "block") {
    return moveBlockTo(blocks, drag.blockIndex, blockIndex);
  }
  return false;
}

/**
 * Apply a drop onto the blocks tray / empty drop zone (new block or reorder to end).
 * @param {PhotoBlock[]} blocks
 * @param {DragPayload | null} drag
 * @returns {boolean}
 */
export function applyDropOnBlocksTray(blocks, drag) {
  if (!drag) return false;
  if (drag.kind === "gallery") {
    return createBlockFromGallery(blocks, drag.relativePath, drag.name);
  }
  if (drag.kind === "thumb") {
    return extractThumbToNewBlock(blocks, drag.relativePath, {
      fromBlockIndex: drag.blockIndex,
      fromImageIndex: drag.imageIndex,
    });
  }
  if (drag.kind === "block") {
    return moveBlockTo(blocks, drag.blockIndex, blocks.length - 1);
  }
  return false;
}

/** dataTransfer MIME for drag payload */
export const DRAG_MIME = "application/x-sm-photo-drag";

/**
 * @param {DragPayload} drag
 * @returns {string}
 */
export function serializeDrag(drag) {
  return JSON.stringify(drag);
}

/**
 * @param {string | null | undefined} raw
 * @returns {DragPayload | null}
 */
export function parseDrag(raw) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || !d.kind) return null;
    return d;
  } catch {
    return null;
  }
}
