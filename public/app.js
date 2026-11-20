const state = {
  groups: [],
  group: "",
  days: [],
  day: "",
  photos: [],
  /** Pending multi-select in the browse grid (not yet a photo block). */
  selected: new Set(),
  /** Ordered photo blocks: each { images: [{relativePath,name}], caption }. */
  blocks: [],
  defaults: null,
  browseError: null,
  filters: { sender: "", date: "", text: "" },
};

const $ = (id) => document.getElementById(id);

function formatApiError(data, fallback) {
  const base = data?.error || fallback || "Request failed";
  const bits = [];
  if (data?.code) bits.push(`code=${data.code}`);
  if (data?.errno != null && data.errno !== "") bits.push(`errno=${data.errno}`);
  if (data?.path) bits.push(`path=${data.path}`);
  return bits.length ? `${base} (${bits.join(", ")})` : base;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(data, res.statusText));
  return data;
}

function photoUrl(rel) {
  return `/api/photo-file?path=${encodeURIComponent(rel)}`;
}

function usedPaths() {
  const used = new Set();
  for (const b of state.blocks) {
    for (const img of b.images) used.add(img.relativePath);
  }
  return used;
}

function renderPathMeta() {
  const d = state.defaults;
  if (!d) return;
  const err =
    state.browseError ||
    (d.paths.listError && formatApiError(d.paths.listError));
  $("pathMeta").textContent =
    `mode: ${d.paths.useMock ? "MOCK" : "LIVE"}\n` +
    `photos: ${d.paths.photoBackupRoot}\n` +
    `Site Memo: ${d.paths.siteMemoRoot}` +
    (state.group ? `\ngroup: ${state.group}` : "") +
    (err ? `\nERROR: ${err}` : "");
  $("pathMeta").classList.toggle("error", Boolean(err));
}

function renderLocked() {
  const L = state.defaults.projectLocked;
  $("lockedFields").innerHTML =
    `<div class="guide-locked-row">` +
    `<span class="guide-locked-item" data-guide-field="2"><span class="guide-num" data-guide="2" aria-hidden="true">2</span><b>From</b> ${escape(L.from_name)}</span>` +
    `<span class="guide-locked-item" data-guide-field="3"><span class="guide-num" data-guide="3" aria-hidden="true">3</span><b>To</b> ${escape(L.to_names)}</span>` +
    `</div>` +
    `<div class="guide-locked-row">` +
    `<span class="guide-locked-item" data-guide-field="5"><span class="guide-num" data-guide="5" aria-hidden="true">5</span><b>Company</b> ${escape(L.company)}</span>` +
    `<span class="guide-locked-item" data-guide-field="8"><span class="guide-num" data-guide="8" aria-hidden="true">8</span><b>Project</b> (locked)</span>` +
    `</div>` +
    `<div class="guide-locked-row">` +
    `<span class="guide-locked-item" data-guide-field="6"><span class="guide-num" data-guide="6" aria-hidden="true">6</span><b>Our Ref.</b> ${escape(L.our_ref_prefix)}{nnn}</span>` +
    `<span class="guide-locked-item" data-guide-field="12"><span class="guide-num" data-guide="12" aria-hidden="true">12</span><b>Signatory</b> ${escape(L.signatory_name)}</span>` +
    `</div>` +
    `<div>Project-locked for LK-P01043 — not editable in this UI</div>`;
  bindGuideFieldHovers($("lockedFields"));
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGroups() {
  const sel = $("groupSelect");
  sel.innerHTML = "";
  if (!state.groups.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no group folders under Group_photo_backup)";
    sel.appendChild(opt);
    return;
  }
  for (const group of state.groups) {
    const opt = document.createElement("option");
    opt.value = group;
    opt.textContent = group;
    sel.appendChild(opt);
  }
  sel.value = state.group;
}

function renderDays() {
  const sel = $("daySelect");
  sel.innerHTML = "";
  if (!state.days.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no YYYY-MM-DD folders found)";
    sel.appendChild(opt);
    return;
  }
  for (const day of state.days) {
    const opt = document.createElement("option");
    opt.value = day;
    opt.textContent = day;
    sel.appendChild(opt);
  }
  sel.value = state.day;
}

function defaultCaptionFor(photos) {
  if (photos.length === 1) {
    return `Photo of ${photos[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")}`;
  }
  return `Photos (${photos.length})`;
}

function tagSummary(p) {
  const t = p.tags;
  if (!t) return "";
  const bits = [];
  if (t.sender) bits.push(t.sender);
  if (t.sendDate) bits.push(t.sendDate);
  if (t.caption) bits.push(t.caption);
  return bits.join(" · ");
}

/** @type {null | { kind: 'gallery'|'thumb'|'block', relativePath?: string, name?: string, blockIndex?: number, imageIndex?: number }} */
let activeDrag = null;
/** Skip the click that follows a successful drag on gallery cards. */
let suppressNextPhotoClick = false;

function clearDropHighlights() {
  document
    .querySelectorAll(".drop-target, .dragging")
    .forEach((el) => el.classList.remove("drop-target", "dragging"));
}

function endDrag() {
  activeDrag = null;
  clearDropHighlights();
}

function photoFromPath(relativePath) {
  return state.photos.find((p) => p.relativePath === relativePath) || null;
}

function findImageLocation(relativePath) {
  for (let bi = 0; bi < state.blocks.length; bi++) {
    const ii = state.blocks[bi].images.findIndex(
      (img) => img.relativePath === relativePath
    );
    if (ii >= 0) return { blockIndex: bi, imageIndex: ii };
  }
  return null;
}

/**
 * Move or insert an image into a target block at imageIndex (append if null/undefined).
 * @returns {boolean}
 */
function placeImageInBlock(img, toBlockIndex, toImageIndex) {
  if (!img?.relativePath || toBlockIndex < 0 || toBlockIndex >= state.blocks.length) {
    return false;
  }
  const existing = findImageLocation(img.relativePath);
  let targetBlock = toBlockIndex;
  let targetIndex =
    toImageIndex == null || toImageIndex < 0
      ? state.blocks[targetBlock].images.length
      : toImageIndex;

  if (existing) {
    const { blockIndex: fromB, imageIndex: fromI } = existing;
    if (fromB === targetBlock && (fromI === targetIndex || fromI === targetIndex - 1)) {
      return false;
    }
    const [moved] = state.blocks[fromB].images.splice(fromI, 1);
    if (fromB === targetBlock && fromI < targetIndex) targetIndex -= 1;
    if (!state.blocks[fromB].images.length) {
      state.blocks.splice(fromB, 1);
      if (fromB < targetBlock) targetBlock -= 1;
      if (targetBlock < 0 || targetBlock >= state.blocks.length) {
        // Source block removed and target vanished — recreate as new block.
        state.blocks.push({
          images: [moved],
          caption: defaultCaptionFor([moved]),
        });
        return true;
      }
    }
    const block = state.blocks[targetBlock];
    const clamped = Math.max(0, Math.min(targetIndex, block.images.length));
    block.images.splice(clamped, 0, moved);
    return true;
  }

  if (usedPaths().has(img.relativePath)) return false;
  const block = state.blocks[targetBlock];
  const clamped = Math.max(0, Math.min(targetIndex, block.images.length));
  block.images.splice(clamped, 0, {
    relativePath: img.relativePath,
    name: img.name,
  });
  state.selected.delete(img.relativePath);
  return true;
}

function createBlockFromGallery(relativePath, name, atIndex) {
  if (usedPaths().has(relativePath)) return false;
  const photo = photoFromPath(relativePath);
  const img = {
    relativePath,
    name: name || photo?.name || relativePath.split("/").pop(),
  };
  const block = {
    images: [img],
    caption: defaultCaptionFor([img]),
  };
  if (atIndex == null || atIndex < 0 || atIndex > state.blocks.length) {
    state.blocks.push(block);
  } else {
    state.blocks.splice(atIndex, 0, block);
  }
  state.selected.delete(relativePath);
  return true;
}

function moveBlockTo(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.blocks.length ||
    toIndex >= state.blocks.length
  ) {
    return false;
  }
  const [block] = state.blocks.splice(fromIndex, 1);
  state.blocks.splice(toIndex, 0, block);
  return true;
}

function moveImageWithinBlock(blockIndex, fromIndex, delta) {
  const block = state.blocks[blockIndex];
  if (!block) return;
  const to = fromIndex + delta;
  if (to < 0 || to >= block.images.length) return;
  const tmp = block.images[fromIndex];
  block.images[fromIndex] = block.images[to];
  block.images[to] = tmp;
  renderBlocks();
}

function applyDropOnBlock(blockIndex, beforeImageIndex) {
  if (!activeDrag) return false;
  if (activeDrag.kind === "gallery") {
    return placeImageInBlock(
      { relativePath: activeDrag.relativePath, name: activeDrag.name },
      blockIndex,
      beforeImageIndex
    );
  }
  if (activeDrag.kind === "thumb") {
    return placeImageInBlock(
      { relativePath: activeDrag.relativePath, name: activeDrag.name },
      blockIndex,
      beforeImageIndex
    );
  }
  if (activeDrag.kind === "block") {
    return moveBlockTo(activeDrag.blockIndex, blockIndex);
  }
  return false;
}

function applyDropOnBlocksTray() {
  if (!activeDrag) return false;
  if (activeDrag.kind === "gallery") {
    return createBlockFromGallery(activeDrag.relativePath, activeDrag.name);
  }
  if (activeDrag.kind === "thumb") {
    const loc = findImageLocation(activeDrag.relativePath);
    if (!loc) return false;
    const [img] = state.blocks[loc.blockIndex].images.splice(loc.imageIndex, 1);
    if (!state.blocks[loc.blockIndex].images.length) {
      state.blocks.splice(loc.blockIndex, 1);
    }
    state.blocks.push({
      images: [img],
      caption: defaultCaptionFor([img]),
    });
    return true;
  }
  if (activeDrag.kind === "block") {
    return moveBlockTo(activeDrag.blockIndex, state.blocks.length - 1);
  }
  return false;
}

function bindBlockDropTarget(el, blockIndex) {
  el.addEventListener("dragover", (e) => {
    if (!activeDrag) return;
    if (
      activeDrag.kind === "gallery" ||
      activeDrag.kind === "thumb" ||
      activeDrag.kind === "block"
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect =
        activeDrag.kind === "gallery" ? "copy" : "move";
      el.classList.add("drop-target");
    }
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = applyDropOnBlock(blockIndex, null);
    endDrag();
    if (ok) {
      renderPhotos();
      renderBlocks();
    }
  });
}

function renderPhotos() {
  const grid = $("photoGrid");
  grid.innerHTML = "";
  const used = usedPaths();
  for (const p of state.photos) {
    const isPdf = p.mediaType === "pdf" || p.pickable === false;
    const inBlock = used.has(p.relativePath);
    const pending = state.selected.has(p.relativePath);
    const pickable = !isPdf && !inBlock;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "photo-card" +
      (isPdf ? " is-pdf" : "") +
      (pending ? " selected" : "") +
      (inBlock ? " in-block" : "");
    btn.disabled = isPdf || inBlock;
    btn.draggable = pickable;
    btn.title = isPdf
      ? "PDF — browse/filter only (not for Site Memo photo blocks)"
      : inBlock
        ? "Already in a photo block"
        : pending
          ? "Click to deselect · drag onto a photo block"
          : "Click to select · drag onto a photo block";
    const mediaHtml = isPdf
      ? `<div class="pdf-placeholder" aria-hidden="true">PDF</div>`
      : `<img src="${photoUrl(p.relativePath)}" alt="" draggable="false"/>`;
    const badge = isPdf
      ? `<span class="media-badge">PDF</span>`
      : "";
    const tags = tagSummary(p);
    btn.innerHTML =
      `${badge}${mediaHtml}<span>${escape(p.name)}</span>` +
      (tags ? `<span class="tag-line" title="${escape(tags)}">${escape(tags)}</span>` : "");
    if (pickable) {
      btn.addEventListener("click", () => {
        if (suppressNextPhotoClick) {
          suppressNextPhotoClick = false;
          return;
        }
        toggleSelect(p);
      });
      btn.addEventListener("dragstart", (e) => {
        activeDrag = {
          kind: "gallery",
          relativePath: p.relativePath,
          name: p.name,
        };
        suppressNextPhotoClick = true;
        btn.classList.add("dragging");
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", p.relativePath);
      });
      btn.addEventListener("dragend", () => {
        endDrag();
        // Allow a short window so the following click is ignored.
        setTimeout(() => {
          suppressNextPhotoClick = false;
        }, 50);
      });
    }
    grid.appendChild(btn);
  }
  renderSelectActions();
}

function toggleSelect(photo) {
  if (photo.mediaType === "pdf" || photo.pickable === false) return;
  if (usedPaths().has(photo.relativePath)) return;
  if (state.selected.has(photo.relativePath)) {
    state.selected.delete(photo.relativePath);
  } else {
    state.selected.add(photo.relativePath);
  }
  renderPhotos();
  // Refresh "+ selected" enable state on existing blocks.
  if (state.blocks.length) renderBlocks();
}

function selectedPhotos() {
  return state.photos.filter(
    (p) =>
      state.selected.has(p.relativePath) &&
      p.mediaType !== "pdf" &&
      p.pickable !== false
  );
}

function readFiltersFromDom() {
  state.filters = {
    sender: ($("filterSender")?.value || "").trim(),
    date: ($("filterDate")?.value || "").trim(),
    text: ($("filterText")?.value || "").trim(),
  };
  return state.filters;
}

function filterQuery() {
  const f = readFiltersFromDom();
  const q = new URLSearchParams();
  if (f.sender) q.set("sender", f.sender);
  if (f.date) q.set("date", f.date);
  if (f.text) q.set("text", f.text);
  const s = q.toString();
  return s ? `&${s}` : "";
}

function renderSelectActions() {
  const n = state.selected.size;
  const countEl = $("selectCount");
  if (countEl) countEl.textContent = n ? `${n} selected` : "None selected";
  const one = $("addOneBlockBtn");
  const each = $("addEachBtn");
  const clear = $("clearSelectBtn");
  if (one) one.disabled = n === 0;
  if (each) each.disabled = n === 0;
  if (clear) clear.disabled = n === 0;
}

function addAsOneBlock() {
  const photos = selectedPhotos();
  if (!photos.length) return;
  state.blocks.push({
    images: photos.map((p) => ({
      relativePath: p.relativePath,
      name: p.name,
    })),
    caption: defaultCaptionFor(photos),
  });
  state.selected.clear();
  renderPhotos();
  renderBlocks();
}

function addEachSeparately() {
  const photos = selectedPhotos();
  if (!photos.length) return;
  for (const p of photos) {
    state.blocks.push({
      images: [{ relativePath: p.relativePath, name: p.name }],
      caption: defaultCaptionFor([p]),
    });
  }
  state.selected.clear();
  renderPhotos();
  renderBlocks();
}

function clearSelection() {
  state.selected.clear();
  renderPhotos();
}

function moveBlock(index, delta) {
  const j = index + delta;
  if (j < 0 || j >= state.blocks.length) return;
  const tmp = state.blocks[index];
  state.blocks[index] = state.blocks[j];
  state.blocks[j] = tmp;
  renderBlocks();
}

function removeBlock(index) {
  state.blocks.splice(index, 1);
  renderPhotos();
  renderBlocks();
}

function removeImageFromBlock(blockIndex, imageIndex) {
  const block = state.blocks[blockIndex];
  if (!block) return;
  block.images.splice(imageIndex, 1);
  if (!block.images.length) {
    state.blocks.splice(blockIndex, 1);
  }
  renderPhotos();
  renderBlocks();
}

function addSelectedToBlock(blockIndex) {
  const photos = selectedPhotos();
  if (!photos.length) return;
  const block = state.blocks[blockIndex];
  if (!block) return;
  for (const p of photos) {
    if (block.images.some((img) => img.relativePath === p.relativePath)) continue;
    block.images.push({ relativePath: p.relativePath, name: p.name });
  }
  state.selected.clear();
  renderPhotos();
  renderBlocks();
}

function renderBlocks() {
  const root = $("blocks");
  root.innerHTML = "";
  $("blocksEmpty").hidden = state.blocks.length > 0;
  const hasPending = state.selected.size > 0;
  state.blocks.forEach((b, i) => {
    const el = document.createElement("div");
    el.className = "block";
    el.dataset.blockIndex = String(i);
    const multi = b.images.length > 1;
    const thumbs = b.images
      .map((img, j) => {
        const reorderBtns = multi
          ? `<div class="thumb-controls">
              <button type="button" class="btn btn-ghost btn-icon" data-img-left="${i}:${j}" title="Move left" ${j === 0 ? "disabled" : ""}>←</button>
              <button type="button" class="btn btn-ghost btn-icon" data-img-right="${i}:${j}" title="Move right" ${j === b.images.length - 1 ? "disabled" : ""}>→</button>
            </div>`
          : "";
        return `<div class="thumb" draggable="true" data-thumb="${i}:${j}" title="Drag to reorder">
            <img src="${photoUrl(img.relativePath)}" alt="" draggable="false"/>
            <button type="button" class="thumb-rm" data-rm-img="${i}:${j}" title="Remove photo">×</button>
            ${reorderBtns}
          </div>`;
      })
      .join("");
    const names = b.images.map((img) => img.name).join(", ");
    el.innerHTML = `
      <div class="block-handle" draggable="true" title="Drag to reorder blocks" aria-label="Reorder block">⋮⋮</div>
      <div class="thumbs">${thumbs}</div>
      <div>
        <div class="meta">#${i + 1} · ${b.images.length} photo${b.images.length === 1 ? "" : "s"} · ${escape(names)}</div>
        <textarea data-i="${i}" placeholder="Caption for this bordered group"></textarea>
      </div>
      <div class="block-actions">
        <button type="button" class="btn btn-ghost btn-icon" data-up="${i}" title="Move block up">↑</button>
        <button type="button" class="btn btn-ghost btn-icon" data-down="${i}" title="Move block down">↓</button>
        <button type="button" class="btn btn-secondary" data-add-sel="${i}" ${hasPending ? "" : "disabled"} title="Add currently selected photos to this block">+ selected</button>
        <button type="button" class="btn btn-danger" data-rm="${i}">Remove</button>
      </div>`;
    const ta = el.querySelector("textarea");
    ta.value = b.caption;
    ta.addEventListener("input", (e) => {
      state.blocks[i].caption = e.target.value;
    });
    el.querySelector("[data-up]").addEventListener("click", () => moveBlock(i, -1));
    el.querySelector("[data-down]").addEventListener("click", () => moveBlock(i, 1));
    el.querySelector("[data-rm]").addEventListener("click", () => removeBlock(i));
    el.querySelector("[data-add-sel]").addEventListener("click", () =>
      addSelectedToBlock(i)
    );
    el.querySelectorAll("[data-rm-img]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [bi, ii] = btn.getAttribute("data-rm-img").split(":").map(Number);
        removeImageFromBlock(bi, ii);
      });
    });
    el.querySelectorAll("[data-img-left]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [bi, ii] = btn.getAttribute("data-img-left").split(":").map(Number);
        moveImageWithinBlock(bi, ii, -1);
      });
    });
    el.querySelectorAll("[data-img-right]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [bi, ii] = btn.getAttribute("data-img-right").split(":").map(Number);
        moveImageWithinBlock(bi, ii, 1);
      });
    });

    const handle = el.querySelector(".block-handle");
    handle.addEventListener("dragstart", (e) => {
      activeDrag = { kind: "block", blockIndex: i };
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `block:${i}`);
      e.stopPropagation();
    });
    handle.addEventListener("dragend", () => endDrag());

    const thumbsEl = el.querySelector(".thumbs");
    thumbsEl.addEventListener("dragover", (e) => {
      if (!activeDrag || (activeDrag.kind !== "gallery" && activeDrag.kind !== "thumb")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect =
        activeDrag.kind === "gallery" ? "copy" : "move";
      thumbsEl.classList.add("drop-target");
    });
    thumbsEl.addEventListener("dragleave", (e) => {
      if (!thumbsEl.contains(e.relatedTarget)) {
        thumbsEl.classList.remove("drop-target");
      }
    });
    thumbsEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = applyDropOnBlock(i, state.blocks[i].images.length);
      endDrag();
      if (ok) {
        renderPhotos();
        renderBlocks();
      }
    });

    el.querySelectorAll(".thumb[data-thumb]").forEach((thumb) => {
      const [bi, ii] = thumb.getAttribute("data-thumb").split(":").map(Number);
      const img = state.blocks[bi]?.images[ii];
      if (!img) return;
      thumb.addEventListener("dragstart", (e) => {
        activeDrag = {
          kind: "thumb",
          blockIndex: bi,
          imageIndex: ii,
          relativePath: img.relativePath,
          name: img.name,
        };
        thumb.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", img.relativePath);
        e.stopPropagation();
      });
      thumb.addEventListener("dragend", () => endDrag());
      thumb.addEventListener("dragover", (e) => {
        if (!activeDrag || (activeDrag.kind !== "thumb" && activeDrag.kind !== "gallery")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.add("drop-target");
      });
      thumb.addEventListener("dragleave", () => thumb.classList.remove("drop-target"));
      thumb.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = applyDropOnBlock(bi, ii);
        endDrag();
        if (ok) {
          renderPhotos();
          renderBlocks();
        }
      });
    });

    bindBlockDropTarget(el, i);
    root.appendChild(el);
  });

  // Tray accepts gallery → new block (and empty-state drop).
  if (!root.dataset.dndBound) {
    root.dataset.dndBound = "1";
    root.addEventListener("dragover", (e) => {
      if (!activeDrag) return;
      if (
        activeDrag.kind === "gallery" ||
        activeDrag.kind === "thumb" ||
        activeDrag.kind === "block"
      ) {
        e.preventDefault();
        root.classList.add("drop-target");
      }
    });
    root.addEventListener("dragleave", (e) => {
      if (!root.contains(e.relatedTarget)) root.classList.remove("drop-target");
    });
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      const ok = applyDropOnBlocksTray();
      endDrag();
      if (ok) {
        renderPhotos();
        renderBlocks();
      }
    });
  }

  updateFolderPreview();
}

function updateFolderPreview() {
  const subject = $("subject").value.trim() || "{short subject}";
  const short = ($("shortSubject").value.trim() || subject).slice(0, 48);
  const nn = state.defaults?.next?.folder_nn || "nn";
  $("folderPreview").textContent = `Will create: SM-${nn} ${short} (Draft)`;
}

async function loadGroups() {
  try {
    const data = await api("/api/groups");
    state.browseError = null;
    state.groups = data.groups || [];
    state.group =
      data.defaultGroup ||
      state.defaults?.paths?.defaultGroup ||
      state.groups[0] ||
      "";
    renderGroups();
    renderPathMeta();
    if (state.group) await loadDays(state.group);
    else {
      state.days = [];
      state.day = "";
      state.photos = [];
      renderDays();
      renderPhotos();
    }
  } catch (err) {
    state.browseError = String(err.message || err);
    state.groups = [];
    state.group = "";
    state.days = [];
    state.day = "";
    state.photos = [];
    renderGroups();
    renderDays();
    renderPhotos();
    renderPathMeta();
  }
}

async function loadDays(group) {
  state.group = group;
  try {
    const data = await api(`/api/days?group=${encodeURIComponent(group)}`);
    state.browseError = null;
    state.days = data.days;
    state.day = state.days[0] || "";
    renderDays();
    renderPathMeta();
    if (state.day) await loadPhotos(group, state.day);
    else {
      state.photos = [];
      renderPhotos();
    }
  } catch (err) {
    state.browseError = String(err.message || err);
    state.days = [];
    state.day = "";
    state.photos = [];
    renderDays();
    renderPhotos();
    renderPathMeta();
  }
}

async function loadPhotos(group, day) {
  state.group = group;
  state.day = day;
  const data = await api(
    `/api/photos?group=${encodeURIComponent(group)}&day=${encodeURIComponent(day)}${filterQuery()}`
  );
  state.photos = data.photos;
  // Drop pending selections that are no longer in this day grid.
  const alive = new Set(state.photos.map((p) => p.relativePath));
  for (const rel of [...state.selected]) {
    if (!alive.has(rel)) state.selected.delete(rel);
  }
  // Never keep PDFs in the pending selection set.
  for (const p of state.photos) {
    if (
      (p.mediaType === "pdf" || p.pickable === false) &&
      state.selected.has(p.relativePath)
    ) {
      state.selected.delete(p.relativePath);
    }
  }
  renderPhotos();
}

function clearFilters() {
  if ($("filterSender")) $("filterSender").value = "";
  if ($("filterDate")) $("filterDate").value = "";
  if ($("filterText")) $("filterText").value = "";
  state.filters = { sender: "", date: "", text: "" };
  if (state.group && state.day) loadPhotos(state.group, state.day);
}

let filterTimer = null;
function onFilterInput() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    if (state.group && state.day) loadPhotos(state.group, state.day);
  }, 250);
}

async function loadAuthChrome() {
  const banner = $("authBanner");
  const signOut = $("signOutLink");
  try {
    const st = await fetch("/api/auth-status", { cache: "no-store" }).then((r) =>
      r.json()
    );
    if (banner) {
      if (st.authRequired) {
        banner.hidden = true;
        banner.textContent = "";
      } else {
        banner.hidden = false;
        banner.textContent =
          "Password gate is OFF. Set DRAFT_UI_PASSWORD in .env and restart before sharing a tunnel URL.";
      }
    }
    if (signOut) {
      signOut.hidden = !st.authRequired;
      signOut.href = st.logout || "/logout";
    }
  } catch {
    if (banner) {
      banner.hidden = false;
      banner.textContent =
        "Could not read /api/auth-status — restart Draft UI after git pull.";
    }
  }
}

async function loadDefaults() {
  state.defaults = await api("/api/defaults");
  $("date").value = state.defaults.date;
  $("memoNumber").value = state.defaults.next.memo_number;
  renderPathMeta();
  renderLocked();
  updateFolderPreview();
}

async function submit() {
  const result = $("result");
  const btn = $("submitBtn");
  result.hidden = false;
  result.classList.remove("error");
  result.textContent = "Creating Draft…";
  btn.disabled = true;
  try {
    const bullets = $("bodyBullets")
      .value.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      date: $("date").value.trim(),
      subject: $("subject").value.trim(),
      short_subject: $("shortSubject").value.trim() || undefined,
      copy_to: $("copyTo").value,
      body_intro: $("bodyIntro").value,
      body_items: bullets,
      photo_blocks: state.blocks.map((b) => {
        const images = b.images.map((img) => img.relativePath);
        return {
          // Keep image for back-compat with older createDraft paths.
          image: images[0],
          images,
          caption: b.caption,
        };
      }),
    };
    const created = await api("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    result.textContent =
      `Draft created.\n` +
      `Folder: ${created.folder_path}\n` +
      `File:   ${created.file_path}\n` +
      `Memo #: ${created.memo_number}  (status Draft — never Submitted)\n` +
      `Photo blocks: ${created.photo_count}\n\n` +
      `Open the .doc in Word to review, then rename the folder to (Submitted) when issued.`;
    await loadDefaults();
  } catch (err) {
    result.classList.add("error");
    result.textContent = String(err.message || err);
  } finally {
    btn.disabled = false;
  }
}

$("groupSelect").addEventListener("change", (e) => loadDays(e.target.value));
$("daySelect").addEventListener("change", (e) =>
  loadPhotos(state.group, e.target.value)
);
$("subject").addEventListener("input", updateFolderPreview);
$("shortSubject").addEventListener("input", updateFolderPreview);
$("submitBtn").addEventListener("click", submit);
$("addOneBlockBtn").addEventListener("click", addAsOneBlock);
$("addEachBtn").addEventListener("click", addEachSeparately);
$("clearSelectBtn").addEventListener("click", clearSelection);
$("filterSender")?.addEventListener("input", onFilterInput);
$("filterDate")?.addEventListener("input", onFilterInput);
$("filterText")?.addEventListener("input", onFilterInput);
$("clearFiltersBtn")?.addEventListener("click", clearFilters);

/** @type {string | null} */
let activeGuide = null;

function clearGuideHighlight() {
  document
    .querySelectorAll(".guide-active")
    .forEach((el) => el.classList.remove("guide-active"));
  activeGuide = null;
}

/**
 * Highlight sample markers + matching form controls for a guide number.
 * @param {string | number | null} n
 * @param {{ scrollField?: boolean, scrollMarker?: boolean }} [opts]
 */
function setGuideActive(n, opts = {}) {
  const id = n == null || n === "" ? null : String(n);
  clearGuideHighlight();
  if (!id) return;
  activeGuide = id;
  document.querySelectorAll(`[data-guide="${id}"]`).forEach((el) => {
    el.classList.add("guide-active");
  });
  document.querySelectorAll(`[data-guide-field~="${id}"]`).forEach((el) => {
    el.classList.add("guide-active");
  });
  if (opts.scrollField !== false) {
    const field = document.querySelector(`[data-guide-field~="${id}"]`);
    if (field) field.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  if (opts.scrollMarker) {
    const marker = document.querySelector(
      `.memo-guide-figure .guide-marker[data-guide="${id}"]`
    );
    if (marker) {
      marker.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const guide = $("memoGuide");
      if (guide && !guide.open) guide.open = true;
    }
  }
}

/**
 * @param {ParentNode | null} root
 */
function bindGuideFieldHovers(root) {
  if (!root) return;
  root.querySelectorAll("[data-guide-field]").forEach((el) => {
    if (el.dataset.guideBound === "1") return;
    el.dataset.guideBound = "1";
    el.addEventListener("mouseenter", () => {
      const n = el.getAttribute("data-guide-field")?.trim().split(/\s+/)[0];
      if (n) setGuideActive(n, { scrollField: false, scrollMarker: true });
    });
    el.addEventListener("focusin", () => {
      const n = el.getAttribute("data-guide-field")?.trim().split(/\s+/)[0];
      if (n) setGuideActive(n, { scrollField: false, scrollMarker: true });
    });
    el.addEventListener("click", () => {
      const n = el.getAttribute("data-guide-field")?.trim().split(/\s+/)[0];
      if (n) setGuideActive(n, { scrollField: false, scrollMarker: true });
    });
  });
}

/**
 * Desktop (≥768px): guide open by default. Phone: collapsed (still expandable).
 * Inline script in index.html applies this before paint; this keeps app.js in sync.
 */
function syncGuideOpenForViewport() {
  const guide = $("memoGuide");
  if (!guide || guide.dataset.userToggled === "1") return;
  guide.open = window.matchMedia("(min-width: 768px)").matches;
}

function initMemoGuide() {
  const guide = $("memoGuide");
  if (guide) {
    syncGuideOpenForViewport();
    const summary = guide.querySelector("summary");
    summary?.addEventListener("click", () => {
      // After the browser toggles open, remember the user chose explicitly.
      queueMicrotask(() => {
        guide.dataset.userToggled = "1";
      });
    });
  }

  const figure = $("memoGuideFigure");
  if (!figure) return;

  figure.querySelectorAll(".guide-marker").forEach((btn) => {
    const activate = () =>
      setGuideActive(btn.getAttribute("data-guide"), {
        scrollField: true,
        scrollMarker: false,
      });
    btn.addEventListener("mouseenter", activate);
    btn.addEventListener("focus", activate);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      activate();
    });
  });

  document.querySelectorAll(".memo-guide-legend [data-guide]").forEach((li) => {
    const activate = () =>
      setGuideActive(li.getAttribute("data-guide"), {
        scrollField: true,
        scrollMarker: true,
      });
    li.addEventListener("mouseenter", activate);
    li.addEventListener("click", activate);
  });

  bindGuideFieldHovers(document);
}

initMemoGuide();

await loadAuthChrome();
await loadDefaults();
await loadGroups();
