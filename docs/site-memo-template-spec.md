# Site Memo Template Specification (LK-P01043)

Derived from the five sample memos (Project store `docs/sample-memos/`; not committed here), with project decisions recorded in Project preferences (2026-11-18).

**Editable blank template (canonical):** `docs/site-memo-template.doc`  
**Field map:** `docs/site-memo-field-map.json`  
**Letterhead (from samples):** `docs/site-memo-assets/lap-kei-letterhead.png`

Sample memos remain in the Project store (large binaries omitted from this repo):

- `Site_Memo_LK-P01043-SM-001.doc` … `SM-005.doc`

Template structure and photo-table borders are taken from **SM-005** (last sample): single-column, 2-row tables, `BorderStyle.Single`, line width **0.5**.

---

## 1. Document purpose

Bilingual (English primary + Chinese label row) **Site Memo** on Lap Kei Engineering letterhead. Notify the client of site findings, requested alterations, clearances, or deliveries.

**Output format for this project:** unlocked editable **`.doc`** (legacy Word), so teammates on older Word can open files. Do not use form locking, restricted editing, or PDF-only as the working memo.

---

## 2. Never-change / corporate boilerplate

Identical unless corporate stationery is deliberately updated.

| Item | Notes |
| --- | --- |
| **Letterhead banner** | Reuse the heading image taken from the five samples (same PNG in every file). Asset: `docs/site-memo-assets/lap-kei-letterhead.png`. Do **not** invent a separate master letterhead file. |
| **Title** | Centered `Site Memo` |
| **Header labels (EN)** | `From`, `To`, `Date`, `Company`, `Our Ref.`, `Copy to`, `Project:`, `Subject:` |
| **Header labels (ZH)** | `由`, `致`, `日期`, `公司`, `編號`, `副本致` |
| **Routing layout** | Two-column paragraph block (as in samples): left From/Date/Our Ref; right To/Company/Copy to; Chinese on the line under each English label |
| **Closing** | `Yours faithfully,` / `For and on behalf of` / `Lap Kei Engineering Co., Ltd.` |
| **Section order** | Letterhead → title → routing → Project → Subject → body → photo tables → closing → signatory → initials |
| **Editability** | Unlocked `.doc` (Security: 0). No content-control locks. |
| **Photo table styling** | Match SM-005: bordered tables, Single / 0.5 width on all sides; image row then caption row |

### Letterhead text (as in sample header image)

- 立基冷氣工程有限公司  
- LAP KEI ENGINEERING COMPANY LIMITED  
- (a wholly-owned subsidiary of Lap Kei Engineering (Holdings) Limited. Stock code : 1690)  
- Room 6, 6th Floor, Block B, Tonic Industrial Centre, 19 Lam Hing Street, Kowloon Bay, Kln. H.K.  
- Tel: (852) 2798 8210 / Fax: (852) 2759 1222  
- E-mail: info@lapkeieng.com.hk / Website: www.lapkeieng.com  
- HKQAA Certified Company; ISO 9001 : 2015; Certificate No.: CC1211  
- Registered Electrical / Ventilation / Minor Works / Fire Services Installation Contractor; Approved Specialist Contractor for Public Works  

Closing uses **Lap Kei Engineering Co., Ltd.**; letterhead uses **LAP KEI ENGINEERING COMPANY LIMITED** — keep both as in samples.

---

## 3. Field classes for LK-P01043

### 3.1 Project-locked defaults (do not change in generated memos for this project)

Automation and defaults must keep these stable for **LK-P01043**. Another project may override them when the same tooling is reused.

| Field key | LK-P01043 default | Notes |
| --- | --- | --- |
| `from_name` | `Mr. Howard Chan` | Sender — fixed for this project |
| `to_names` | `Mr. Mr.Y.T. Huang /Benny Cheung` | Receiver — fixed for this project (majority in samples; SM-003 historically differed; going forward do not vary) |
| `company` | `Huawei International Co. Limited` | |
| `our_ref_prefix` | `LK/P01043/SM/` | |
| `project_title` | `Framework Procurement Project For Phase 2 Expansion of The Second Data Center In GUANGDONG-Hong Kong- Macao Greater Bay Area (Hong Kong )` | Exact sample wording |
| `signatory_name` | `KS Ho` | |
| `signatory_title` | `Senior Technical Manager` | |
| `ref_initials` | `KS/hc/yc` | |

These appear as **literal text** in `site-memo-template.doc` (not `{{placeholders}}`).

### 3.2 Per-memo fields (automation / human may change every memo)

| Field key | Placeholder / behavior | Notes |
| --- | --- | --- |
| `date` | `{{date}}` | `DD/MM/YYYY` |
| `memo_number` | `{{memo_number}}` | Zero-padded sequence only: `001`, `002`, … **No `Rn` revision suffixes** — always bump a new SM-xxx |
| `copy_to` | empty editable field | Keep blank by default; humans/automation may fill; never remove the field |
| `subject` | `{{subject}}` | |
| `body_intro` | `{{body_intro}}` | |
| `body_items` / bullets | e.g. `{{body_bullet_1}}` … | SM-005-style bullets in blank template; numbered `1) … Reason:` also valid (SM-001/002) |
| `photo_blocks[]` | Prototype `{{photo_block.image}}` + `{{photo_block.caption}}`; generator clones × N | Length N at generate time → N bordered tables; caption plain editable text |

---

## 4. Naming conventions

### File name

```text
Site_Memo_LK-P01043-SM-{NNN}.doc
```

Example next memo after samples: `Site_Memo_LK-P01043-SM-006.doc`

### Our Ref. (inside document)

```text
Our Ref. : LK/P01043/SM/
編號     {NNN}
```

**No** `{NNN}R{n}` — if content changes, issue a **new** SM number.

### Other projects (tooling reuse only)

```text
Site_Memo_{PARTY}-{PROJECT}-SM-{NNN}.doc
Our Ref. : {PARTY}/{PROJECT}/SM/
編號     {NNN}
```

Override project-locked defaults (From, To, Company, project title, Our Ref prefix, signatory) for that project only.

---

## 5. Section order

1. Letterhead (from sample heading)  
2. `Site Memo`  
3. Routing (From/To, Date/Company, Our Ref./Copy to + ZH labels)  
4. `Project:` + project title  
5. `Subject:` + subject  
6. Body (intro and/or bullets / numbered items)  
7. Photo tables — **N** cloned SM-005-style blocks from `photo_blocks[]`  
8. Closing  
9. Signatory name / title  
10. Reference initials  

---

## 6. Photo / attachment rules (generate-time loop)

**Product answer:** Yes — the number of photo borders follows the photo groups you assign at generate time. This is **not** a static Word for-loop inside the blank file. Automation reads `photo_blocks[]` of length **N** and emits **N** identical bordered photo+caption tables into the `.doc`.

### Looping unit: `photo_blocks[]`

Each element is one **photo group / block**:

| Property | Required | Meaning |
| --- | --- | --- |
| `image` | yes (for generation) | One image for the block (path/binary) |
| `caption` | yes | Plain editable caption text under the image |

Default contract for LK-P01043 generation: **one image + one caption per block** (matches SM-005). Samples SM-001–003 sometimes put **multiple images in one bordered group under a single caption**; treat that as an optional extension (`images[]` under one caption), not the blank-template default.

### How generation works

1. Author/tooling assigns `photo_blocks` = `[block1, …, blockN]` (N ≥ 0).  
2. Generator finds the **prototype** photo table in `site-memo-template.doc` (`{{photo_block.image}}` / `{{photo_block.caption}}`).  
3. Clones that table **N** times (or removes it if N = 0).  
4. For each clone *i*: insert the image; set caption to plain text from `photo_blocks[i].caption` (no merge-field locks).  
5. Each emitted table keeps SM-005 styling: **1 column × 2 rows**, borders **Single / 0.5**, unlocked/editable.

### Styling (fixed)

- Inline bordered tables (not a separate attachment list).  
- Prototype pattern: row 1 = image; row 2 = caption.  
- Borders: **Single**, width **0.5** (all sides).  
- Captions remain normal Word text — humans can edit after generation.  
- Caption examples from samples: `Photo of …`, `Site Photo`, `Location Plan …`, `Delivery Note`, etc.

### Limits

- Blank template ships **one** cloneable prototype block (not a hard-coded count).  
- Multi-column / multi-image-in-one-caption layouts appear in earlier samples; generators may support them later but must still use Single/0.5 borders.

---

## 7. Editability rules

1. Generate **`.doc`**, unlocked.  
2. Per-memo values use plain `{{…}}` placeholders (or direct text after generation).  
3. Do not enable Restrict Editing / passwords.  
4. Do not deliver PDF-only as the working copy.  
5. Humans may edit any field after generation, including project defaults if they must — automation should still emit the locked defaults for LK-P01043.

---

## 8. Template deliverable

`docs/site-memo-template.doc` is cloned from SM-005 styling:

- Sample letterhead retained  
- Project-locked From / To / Company / Our Ref prefix / Project / signatory / initials as literals  
- Empty **Copy to** field retained  
- `{{date}}`, `{{memo_number}}`, `{{subject}}`, body placeholders  
- **One** cloneable photo-block prototype: `{{photo_block.image}}` / `{{photo_block.caption}}`, Single / 0.5 borders, 2×1 table — generator duplicates it for each assigned group  

---

## 9. Resolved decisions (were open questions)

| Topic | Decision |
| --- | --- |
| Letterhead source | Use heading from the five samples only; no separate invented master |
| Revisions | Bump new SM-xxx only; do not use Rn |
| Copy to | Keep editable empty field |
| From / To / signatory | Project defaults for LK-P01043; other projects may override |
| Output format | Prefer `.doc` |
| Table/border styling | Match last sample (SM-005): Single / 0.5 |

---

## 10. Preferences source

See the Project store `preferences.md` for the saved project preferences that this spec implements.
