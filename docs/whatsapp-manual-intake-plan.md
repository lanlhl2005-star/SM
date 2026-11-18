# WhatsApp Manual Intake Plan (LK-P01043)

Manual-drop path: a personal WhatsApp number joins several project groups, backs up each group’s photos to the server, then a site-memo UI picks/groups/captions photos and generates an unlocked editable `.doc` for Word review under the live Site Memo share.

Related: `docs/site-memo-template-spec.md`, `docs/site-memo-field-map.json`, and Project store `preferences.md`.

---

## 1. Goals / out of scope

**Goals**

- Personal WhatsApp number joins **several** project groups (site memo, material delivery, internal communication, BIM coordination, etc.) and backs up photos from each to the server under per-group folders with **required** `YYYY-MM-DD` day folders (separate from the Site Memo store).
- Site-memo UI: browse the **site-memo** photo backup → select photos → group into `photo_blocks` → type captions → submit.
- On submit, the program creates **Draft only**: next per-memo folder `SM-{nn} … (Draft)` under the live Site Memo root and an unlocked `.doc` inside for Word review. It never marks folders `(Submitted)`.
- Project-locked From/To/Company/signatory; bump `SM-xxx` only (no Rn); N photo groups → N bordered captioned tables.

**Out of scope (this phase)**

- WhatsApp Cloud API / Business API.
- Auto-send of the generated `.doc` into any WhatsApp group (**ON HOLD** — personal number limitation). Do not design bot send.
- Personal number is for **backup/export only** — not automated reply or send.
- Memo generate UI for non–site-memo groups (material delivery, internal, BIM, etc.) — those backups are **storage only** for now; wiring them into other UIs is **future**.

---

## 2. Server paths

### Site Memo root (live — generated/edited memos)

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

**Existing folders (as of capture):**

| Folder | Status |
| --- | --- |
| `SM-01 RF Diversion (Submitted)` | Submitted |
| `SM-02 14F Diversion (Submitted)` | Submitted |
| `SM-03 14F RF Request Clear Material (Submitted…)` | Submitted |
| `SM-04 4F to 7F Request Diversion of Trun… (Submitted)` | Submitted |
| `SM-05 notice of Chilled water Pipe Delive… (Submitted)` | Submitted |

**Folder naming (match live store):**

```text
SM-{nn} {short subject} ({status})
```

- `{nn}` — next sequence after existing folders (today: next is **06** → `SM-06 …`). Match the live two-digit style (`SM-01` …), not a separate `drafts/` / `issued/` tree.
- `{short subject}` — brief human title (same spirit as existing folders).
- `{status}` — **program always creates `(Draft)` only.** Live folders use `(Submitted)` when issued; a human renames `(Draft)` → `(Submitted)` after Word review. The program must not write `(Submitted)` or invent parallel `memos/drafts` / `memos/issued` trees.

**Inside each SM folder:** place the unlocked generated `.doc` (e.g. `Site_Memo_LK-P01043-SM-{NNN}.doc` or the team’s usual Word filename). Supporting images may be copied here if the team already keeps attachments with the memo; photo **source of truth for picking** remains the WhatsApp backup.

### WhatsApp photo backup (separate)

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
```

Sibling of `Site Memo` under the same project. One folder per WA **group subject** (live display name, sanitized), plus `individual` for 1:1 chats; each with required day folders:

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\
  <WhatsApp group name>/
    YYYY-MM-DD/          # required day folder
      <original-filename>
  individual/
    YYYY-MM-DD/
      …
```

Baileys creates group folders from the live subject automatically (no kebab-case alias map). Do not store backup media under the Site Memo root.

**Rules**

- Drop media into the folder for the **source group**; do not mix groups in one folder.
- **Always** use a day folder `YYYY-MM-DD` under each group (required — no flat dump at the group root).
- Preserve original filenames and timestamps when possible; never overwrite silently (suffix if collision).
- Photos stay in backup; generator/UI reads paths from selection (do not delete backup on generate).
- Generated/edited memos land only under `…\Site Memo\SM-{nn} … (Draft)` from the program.

---

## 3. WhatsApp groups → server (manual drop)

Practical options that fit **manual drop** (pick one primary; others as fallback). Apply **per group** into:

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\<group>\YYYY-MM-DD\
```

| Option | How | Fit |
| --- | --- | --- |
| **A. Baileys linked device (primary)** | On a Windows PC: `npm run wa-link` once (spare Linked devices slot), then `npm run wa-backup`. Incoming group photos → `Group_photo_backup\<group subject>\YYYY-MM-DD\`; 1:1 → `individual\YYYY-MM-DD\`. Phone/Desktop daily use undisturbed. **Do not** QR-link from cloud. See `docs/whatsapp-baileys-backup.md`. | Preferred continuous backup |
| **B. Export chat media** | Export that group’s chat **with media**, unzip/copy images into that day’s folder under the group. | Best occasional batch |
| **C. Desktop WhatsApp + copy** | Open the group in WhatsApp Desktop; save/download images into that day’s folder under the group. | Good for frequent drops |
| **D. Shared sync folder** | Colleagues save photos from a group into a share that mirrors `Group_photo_backup\<group>\YYYY-MM-DD\`. | Good if everyone already uses a share |
| **E. Desktop media watcher (deprecated fallback)** | Run `npm run backup-watch` on the PC with WhatsApp Desktop; fragile when media root missing; group attribution best-effort. See `docs/whatsapp-desktop-backup-watch.md`. | Fallback only |

**Operating habit**

1. After useful photos appear in any project group, drop them into `Group_photo_backup\<group>\YYYY-MM-DD\` (create the day folder if missing).
2. Day folders are **required** under every group backup.
3. Personal WA number stays in these groups only to help with backup/export — **not** for automated reply or send.

Do **not** build Cloud API webhooks or bot listeners in this phase.

---

## 4. UI flow (site-memo generate)

Defaults to **`Group_photo_backup\site-memo\` only**. Other group backups are not shown in this UI unless a future option is added.

1. **Browse** `\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\site-memo\YYYY-MM-DD\` (show thumbnails + filename/date).
2. **Select** the photos needed for this memo.
3. **Group** selections into ordered `photo_blocks` (default: one image per block; order = memo table order).
4. **Caption** each block (plain text; editable again later in Word).
5. **Fill** per-memo text: date, subject (also drives short folder title), body intro/items; leave Copy to empty unless needed. From/To/etc. stay project defaults.
6. **Submit** → program creates **only** `SM-{nn} {short subject} (Draft)` under the Site Memo UNC root → write unlocked `.doc` into that folder (never `(Submitted)`).

---

## 5. Hand-off into site memo generator

UI submit payload (logical fields):

| Source | Fields |
| --- | --- |
| **Project-locked (fixed)** | `from_name`, `to_names`, `company`, `our_ref_prefix`, `project_title`, `signatory_name`, `signatory_title`, `ref_initials` |
| **Per memo (from UI)** | `date` (`DD/MM/YYYY`), `memo_number` (auto-bump from last `SM-{nn}` folder), `copy_to` (default empty), `subject`, `body_intro`, `body_items` |
| **Photos** | `photo_blocks[]`: each `{ image: <path under site-memo backup>, caption: <string> }` |

Generator behavior (per template spec / field map):

- Clone the template photo table **N** times for `photo_blocks.length` N (remove prototype if N = 0).
- Each table: image + plain caption; SM-005 borders (Single / 0.5); document unlocked `.doc`.
- Output folder (Draft only): `\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo\SM-{nn} {short subject} (Draft)\`.

---

## 6. Review path

1. Open the new `SM-{nn} … (Draft)` folder on the Site Memo share and open the `.doc` in Word (or download a copy).
2. Human edits text, captions, or replaces photos as needed.
3. When formally issued, a **human** renames `(Draft)` → `(Submitted)` (matches existing SM-01…SM-05). Program does not do this step.
4. Sharing the finished memo with the client/group is **manual** for now (email/share). Auto-post to WhatsApp remains on hold.

---

## 7. Open decisions (only if blocking)

None. Paths and rules are set:

- Site Memo: `\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo`
- Photo backup: `\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup`
- Program creates `(Draft)` only; backup uses per-group `YYYY-MM-DD` day folders.
