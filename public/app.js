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

function renderPhotos() {
  const grid = $("photoGrid");
  grid.innerHTML = "";
  const used = usedPaths();
  for (const p of state.photos) {
    const inBlock = used.has(p.relativePath);
    const pending = state.selected.has(p.relativePath);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "photo-card" +
      (pending ? " selected" : "") +
      (inBlock ? " in-block" : "");
    btn.disabled = inBlock;
    btn.title = inBlock
      ? "Already in a photo block"
      : pending
        ? "Click to deselect"
        : "Click to select";
    btn.innerHTML = `<img src="${photoUrl(p.relativePath)}" alt=""/><span>${escape(p.name)}</span>`;
    btn.addEventListener("click", () => toggleSelect(p));
    grid.appendChild(btn);
  }
  renderSelectActions();
}

function toggleSelect(photo) {
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
  return state.photos.filter((p) => state.selected.has(p.relativePath));
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
    const thumbs = b.images
      .map(
        (img, j) =>
          `<div class="thumb">
            <img src="${photoUrl(img.relativePath)}" alt=""/>
            <button type="button" class="thumb-rm" data-rm-img="${i}:${j}" title="Remove photo">×</button>
          </div>`
      )
      .join("");
    const names = b.images.map((img) => img.name).join(", ");
    el.innerHTML = `
      <div class="thumbs">${thumbs}</div>
      <div>
        <div class="meta">#${i + 1} · ${b.images.length} photo${b.images.length === 1 ? "" : "s"} · ${escape(names)}</div>
        <textarea data-i="${i}" placeholder="Caption for this bordered group"></textarea>
      </div>
      <div class="block-actions">
        <button type="button" data-up="${i}">↑</button>
        <button type="button" data-down="${i}">↓</button>
        <button type="button" data-add-sel="${i}" ${hasPending ? "" : "disabled"} title="Add currently selected photos to this block">+ selected</button>
        <button type="button" data-rm="${i}">Remove</button>
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
      btn.addEventListener("click", () => {
        const [bi, ii] = btn.getAttribute("data-rm-img").split(":").map(Number);
        removeImageFromBlock(bi, ii);
      });
    });
    root.appendChild(el);
  });
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
    `/api/photos?group=${encodeURIComponent(group)}&day=${encodeURIComponent(day)}`
  );
  state.photos = data.photos;
  // Drop pending selections that are no longer in this day grid.
  const alive = new Set(state.photos.map((p) => p.relativePath));
  for (const rel of [...state.selected]) {
    if (!alive.has(rel)) state.selected.delete(rel);
  }
  renderPhotos();
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

await loadDefaults();
await loadGroups();
