# Site Memo (SM)

Program home for **LK-P01043** site memos: collect WhatsApp group photos from a server backup, pick/group/caption them, and generate unlocked editable `.doc` Site Memos for Word review.

This repository holds specs, the blank template, and (later) tooling. Full UI is not implemented yet.

## Server paths

### Site Memo store (generated / edited memos)

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

Per-memo folders match live naming: `SM-{nn} {short subject} ({status})`.

### WhatsApp group photo backup

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
```

Layout (required day folders — no flat dump at the group root):

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\
  <group>/
    YYYY-MM-DD/
      <original-filename>
```

Example groups: `site-memo`, `material-delivery`, `internal`, `bim-coordination`.

## Draft-only rule

The program **always** creates `(Draft)` folders and files only, for example:

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo\SM-06 … (Draft)\
```

Humans rename `(Draft)` → `(Submitted)` after Word review. Automation must never write `(Submitted)`.

## WhatsApp send — on hold

Auto-send of the generated `.doc` into any WhatsApp group is **on hold** (personal-number limitation). Intake for this phase is **manual drop / backup only**. Do not design bot send unless a Business/Cloud API number is added later.

## Docs in this repo

| Doc | Purpose |
| --- | --- |
| [docs/whatsapp-manual-intake-plan.md](docs/whatsapp-manual-intake-plan.md) | Manual WA backup → UI pick/group/caption → Draft `.doc` |
| [docs/site-memo-template-spec.md](docs/site-memo-template-spec.md) | Template structure, field classes, photo-block rules |
| [docs/site-memo-field-map.json](docs/site-memo-field-map.json) | Machine-readable field map for generation |
| [docs/site-memo-template.doc](docs/site-memo-template.doc) | Editable blank `.doc` template (SM-005 styling) |
| [docs/site-memo-assets/lap-kei-letterhead.png](docs/site-memo-assets/lap-kei-letterhead.png) | Letterhead banner reused from sample memos |

Sample memos (`SM-001`…`SM-005`) live in the Project store, not this repo (large binaries).

## Project defaults (LK-P01043)

- **From / To / Company / signatory** — fixed project defaults (see field map).
- **Numbering** — bump `SM-xxx` only; no `Rn` revisions.
- **Copy to** — keep an editable empty field.
- **Output** — unlocked editable `.doc` (not `.docx` as the working memo).
- **Photos** — generate-time `photo_blocks[]` length N → N bordered photo+caption tables (Single / 0.5).

## Skeleton

Minimal placeholder only (`package.json`, empty `src/`). No UI yet.

## License / ownership

Internal project tooling for Lap Kei Engineering site memos on LK-P01043.
