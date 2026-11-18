# Site Memo (SM)

Local web UI for **LK-P01043** site memos: browse WhatsApp group photo backups, group photos into ordered `photo_blocks` with captions, fill date/subject/body, and write an unlocked editable **Draft** `.doc` under the Site Memo share.

**Primary photo intake:** Baileys **linked-device** backup (`npm run wa-link` / `npm run wa-backup`) saves incoming group photos into `Group_photo_backup\<group>\YYYY-MM-DD\` without disturbing phone or Desktop daily use. The older Desktop media-cache watcher is optional/deprecated. Send-to-WhatsApp is **out of scope** (on hold).

## Quick start (Windows colleagues)

```bat
git clone https://github.com/lanlhl2005-star/SM.git
cd SM
copy .env.example .env
npm install
npm start
```

Open **http://127.0.0.1:3847** in a browser.

### Photo backup — Baileys linked device (primary)

Run on an always-on **Windows PC** (not in the cloud). Needs a spare **Linked devices** slot; phone stays primary.

```bat
npm run wa-link
npm run wa-backup
```

- `wa-link` — scan QR once (or `npm run wa-link -- --phone 852…`); credentials under `.wa-auth\` (**gitignored**, never commit).
- `wa-backup` — daemon; incoming photos → `PHOTO_BACKUP_ROOT\<group>\YYYY-MM-DD\`.

Full steps, Task Scheduler tips, and safety rules: [docs/whatsapp-baileys-backup.md](docs/whatsapp-baileys-backup.md).

### Photo backup — Desktop watcher (optional / deprecated)

Fragile when the Desktop media root is missing. Prefer Baileys above.

```bat
npm run backup-watch
npm run backup-watch:once
```

Details: [docs/whatsapp-desktop-backup-watch.md](docs/whatsapp-desktop-backup-watch.md).

### Point at the live shares

Edit `.env` (or set environment variables). UNC works when the share is reachable; a mapped drive letter also works:

```env
USE_MOCK=false
PHOTO_BACKUP_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
SITE_MEMO_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

Mapped-drive example:

```env
USE_MOCK=false
PHOTO_BACKUP_ROOT=S:\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
SITE_MEMO_ROOT=S:\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

Requires **Node.js 20.9+**.

## Mock / cloud fallback

When `USE_MOCK=true` (default in the shipped `.env`) or the live UNC paths are unreachable, the app uses repo fixtures:

```text
mock/Group_photo_backup/site-memo/YYYY-MM-DD/   ← pick photos here
mock/Site Memo/                                 ← Draft folders written here
mock/WhatsAppDesktop/media/                     ← backup-watch source in mock mode
```

Smoke-test without the UI:

```bat
npm run smoke
npm run smoke:backup
npm test
```

> Do **not** run `npm run wa-link` on a cloud agent — link only on the Windows PC that will host the daemon.

## UI flow

1. Choose a **day folder** under `…\Group_photo_backup\site-memo\YYYY-MM-DD\`.
2. Click photos to build ordered **photo blocks** (1 image + 1 editable caption each).
3. Fill **date**, **subject**, body intro/bullets; leave **Copy to** empty unless needed.
4. **Create Draft .doc** → writes only:

```text
…\Site Memo\SM-{nn} {short subject} (Draft)\Site_Memo_LK-P01043-SM-{NNN}.doc
```

The program **never** creates `(Submitted)` folders. After Word review, a human renames `(Draft)` → `(Submitted)`.

## Generator rules

| Rule | Behavior |
| --- | --- |
| From / To / Company / signatory | Project-locked defaults for LK-P01043 |
| Numbering | Bump next `SM-xxx` from existing Site Memo folders; **no Rn** |
| Copy to | Empty editable field by default |
| Photos | `photo_blocks.length` N → N bordered tables (SM-005 Single / 0.5) |
| Output | Unlocked editable `.doc` (Word-compatible HTML `.doc`; opens/edits in Word; layout matches the blank template) |

## Server paths (live)

**Photo backup (browse):**

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\site-memo\YYYY-MM-DD\
```

**Site Memo store (write Draft only):**

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo\
```

## Docs in this repo

| Doc | Purpose |
| --- | --- |
| [docs/whatsapp-baileys-backup.md](docs/whatsapp-baileys-backup.md) | **Primary** Baileys linked-device backup, Windows link/daemon steps |
| [docs/whatsapp-manual-intake-plan.md](docs/whatsapp-manual-intake-plan.md) | Manual WA backup → UI → Draft `.doc` |
| [docs/whatsapp-desktop-backup-watch.md](docs/whatsapp-desktop-backup-watch.md) | Deprecated Desktop media watcher |
| [docs/site-memo-template-spec.md](docs/site-memo-template-spec.md) | Template structure & photo-block rules |
| [docs/site-memo-field-map.json](docs/site-memo-field-map.json) | Machine-readable field map |
| [docs/site-memo-template.doc](docs/site-memo-template.doc) | Blank `.doc` template (SM-005 styling) |
| [docs/site-memo-assets/lap-kei-letterhead.png](docs/site-memo-assets/lap-kei-letterhead.png) | Letterhead from sample memos |

## CLI

```bat
npm run draft -- --subject "14F Diversion" --short "14F Diversion" --image 2026-11-18/IMG_stair_clash.jpg --caption "Photo of Steel stair"
```

## License / ownership

Internal project tooling for Lap Kei Engineering site memos on LK-P01043.
