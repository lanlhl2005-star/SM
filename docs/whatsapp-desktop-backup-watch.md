# WhatsApp Desktop photo backup watcher (optional / deprecated)

> **Prefer Baileys linked-device backup:** [`docs/whatsapp-baileys-backup.md`](whatsapp-baileys-backup.md) (`npm run wa-link` / `npm run wa-backup`). Desktop cache watching is fragile when the media root is missing or files are opaque hashes; keep this path only as a fallback.

Path **2** (legacy) for LK-P01043: a personal WhatsApp number stays in several project groups; **WhatsApp Desktop** on a Windows PC receives the media; this watcher copies new images into the server backup tree used by the Site Memo Draft UI.

**Not** WhatsApp Cloud / Business API. **No** auto-send back into WhatsApp.

Related: `docs/whatsapp-baileys-backup.md`, `docs/whatsapp-manual-intake-plan.md`, `README.md`, `config/default.json`.

---

## Destination (same as Draft UI)

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\<group>\YYYY-MM-DD\
```

Configured via `PHOTO_BACKUP_ROOT` (or mock when `USE_MOCK=true`). Day folders are **required**.

Default groups: `site-memo`, `material-delivery`, `internal`, `bim-coordination`, plus fallback `unmapped`.

---

## Typical Windows media path

WhatsApp Desktop from the Microsoft Store usually caches transferred media under the user’s profile:

```text
%LOCALAPPDATA%\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\shared\transfers
```

Expanded example:

```text
C:\Users\<you>\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\shared\transfers
```

Also check nearby folders if your build differs (`LocalState\media`, etc.). Set the real folder in `.env`:

```env
WA_DESKTOP_MEDIA_ROOT=%LOCALAPPDATA%\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\shared\transfers
```

The package id (`5319275A.WhatsAppDesktop_…`) can change after reinstall; if the path 404s, open `%LOCALAPPDATA%\Packages\` and look for `*WhatsAppDesktop*`.

---

## Honest limitation: group identity

WhatsApp Desktop’s media cache **often does not** store a clear group/chat id next to each image. Filenames are frequently opaque hashes. This tool therefore uses **best-effort** mapping only:

1. **Parent folder name** under the watch root matches a configured `matchNames` / `pathIncludes` entry (best option — see staging tip below).
2. Else **relative path or filename** contains a configured hint string.
3. Else copy into **`unmapped\YYYY-MM-DD\`** (never drop the file).

There is **no** reliable public API on Desktop to map every cache file → group. Do not expect perfect per-group sorting without help from folder layout or naming.

### How to learn / improve mapping

| Approach | How |
| --- | --- |
| **Group display names** | In WhatsApp Desktop, open each project group and note the **exact title**. Put aliases in `config/default.json` → `whatsappDesktop.groupMap.<folder>.matchNames`. |
| **Staging folders** | Create subfolders under a watchable root named like `site-memo`, `material-delivery`, … and periodically save/export that chat’s media into the matching folder (Desktop “Save” / drag). The watcher maps by parent folder. |
| **Manual rename hints** | If you rename a file to include `site-memo` (etc.), path hints can match. |
| **Unmapped triage** | Review `Group_photo_backup\unmapped\YYYY-MM-DD\` and move files into the correct group day folder when needed. |

Edit group rules in `config/default.json` (`whatsappDesktop.groupMap`). Restart the watcher after edits.

---

## Run on Windows (alongside Draft UI)

```bat
cd SM
copy .env.example .env
REM Live share:
REM   USE_MOCK=false
REM   PHOTO_BACKUP_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
REM   WA_DESKTOP_MEDIA_ROOT=%LOCALAPPDATA%\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\shared\transfers

npm install

REM Terminal A — Draft UI
npm start

REM Terminal B — photo backup watcher
npm run backup-watch
```

One-shot scan (Task Scheduler / smoke):

```bat
npm run backup-watch:once
```

### Behaviour

| Rule | Behaviour |
| --- | --- |
| New image under media root | Copy to `<group>\YYYY-MM-DD\` (day from file mtime) |
| Already copied (same path+size+mtime) | Skip (state file `.backup-watch-state.json`) |
| Dest exists, same size | Skip (identical) |
| Dest exists, different size | Write `name_2.ext`, `name_3.ext`, … — **never** silent overwrite |
| Not an image | Ignore |
| WhatsApp send | **Never** |

---

## Mock / cloud testing

With `USE_MOCK=true` (explicit) and no `WA_DESKTOP_MEDIA_ROOT`:

```text
mock/WhatsAppDesktop/media/     ← watched source
mock/Group_photo_backup/        ← copy destination (same as Draft UI mock)
```

```bat
npm run smoke:backup
```

Expect copies under `mock/Group_photo_backup\<group>\YYYY-MM-DD\` and an orphan file under `unmapped\`.
