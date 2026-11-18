const state = {
  groups: [],
  group: "",
  days: [],
  day: "",
  photos: [],
  selected: new Set(),
  blocks: [],
  defaults: null,
};

const $ = (id) => document.getElementById(id);

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function photoUrl(rel) {
  return `/api/photo-file?path=${encodeURIComponent(rel)}`;
}

function renderPathMeta() {
  const d = state.defaults;
  if (!d) return;
  $("pathMeta").textContent =
    `mode: ${d.paths.useMock ? "MOCK" : "LIVE"}\n` +
    `photos: ${d.paths.photoBackupRoot}\n` +
    `Site Memo: ${d.paths.siteMemoRoot}` +
    (state.group ? `\ngroup: ${state.group}` : "");
}

function renderLocked() {
  const L = state.defaults.projectLocked;
  $("lockedFields").innerHTML =
    `<div><b>From</b> ${escape(L.from_name)} &nbsp;|&nbsp; <b>To</b> ${escape(L.to_names)}</div>` +
    `<div><b>Company</b> ${escape(L.company)}</div>` +
    `<div><b>Our Ref.</b> ${escape(L.our_ref_prefix)}{nnn} &nbsp;|&nbsp; <b>Signatory</b> ${escape(L.signatory_name)}</div>` +
    `<div>Project-locked for LK-P01043 — not editable in this UI</div>`;
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

function renderPhotos() {
  const grid = $("photoGrid");
  grid.innerHTML = "";
  for (const p of state.photos) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "photo-card" + (state.selected.has(p.relativePath) ? " selected" : "");
    btn.title = "Add to photo blocks";
    btn.innerHTML = `<img src="${photoUrl(p.relativePath)}" alt=""/><span>${escape(p.name)}</span>`;
    btn.addEventListener("click", () => addBlock(p));
    grid.appendChild(btn);
  }
}

function addBlock(photo) {
  if (state.blocks.some((b) => b.image === photo.relativePath)) return;
  state.selected.add(photo.relativePath);
  state.blocks.push({
    image: photo.relativePath,
    name: photo.name,
    caption: `Photo of ${photo.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")}`,
  });
  renderPhotos();
  renderBlocks();
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
  const [removed] = state.blocks.splice(index, 1);
  if (removed) state.selected.delete(removed.image);
  renderPhotos();
  renderBlocks();
}

function renderBlocks() {
  const root = $("blocks");
  root.innerHTML = "";
  $("blocksEmpty").hidden = state.blocks.length > 0;
  state.blocks.forEach((b, i) => {
    const el = document.createElement("div");
    el.className = "block";
    el.innerHTML = `
      <img src="${photoUrl(b.image)}" alt=""/>
      <div>
        <div class="meta">#${i + 1} · ${escape(b.name || b.image)}</div>
        <textarea data-i="${i}" placeholder="Caption"></textarea>
      </div>
      <div class="block-actions">
        <button type="button" data-up="${i}">↑</button>
        <button type="button" data-down="${i}">↓</button>
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
  const data = await api("/api/groups");
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
}

async function loadDays(group) {
  state.group = group;
  const data = await api(`/api/days?group=${encodeURIComponent(group)}`);
  state.days = data.days;
  state.day = state.days[0] || "";
  renderDays();
  renderPathMeta();
  if (state.day) await loadPhotos(group, state.day);
  else {
    state.photos = [];
    renderPhotos();
  }
}

async function loadPhotos(group, day) {
  state.group = group;
  state.day = day;
  const data = await api(
    `/api/photos?group=${encodeURIComponent(group)}&day=${encodeURIComponent(day)}`
  );
  state.photos = data.photos;
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
      photo_blocks: state.blocks.map((b) => ({
        image: b.image,
        caption: b.caption,
      })),
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
      `Photos: ${created.photo_count}\n\n` +
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

await loadDefaults();
await loadGroups();
