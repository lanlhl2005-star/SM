# WhatsApp Baileys linked-device photo + PDF backup

**Primary** intake path for LK-P01043 Site Memo media. Uses [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) as a **linked device** (WebSocket — **no Chromium**). Incoming **photos and PDFs** land in the same `Group_photo_backup` tree the Draft UI reads, with durable tags for filtering.

Patterns adapted from [whatsapp-media-saver](https://github.com/lanlhl2005-star/whatsapp-media-saver).

The Desktop media-cache watcher (`npm run backup-watch`) remains as an **optional / deprecated** fallback when Baileys cannot run.

**Not** WhatsApp Cloud / Business API. **No** auto-send back into WhatsApp.

---

## Why linked device (not Desktop cache)

| | Baileys linked device (this) | Desktop cache watcher |
| --- | --- | --- |
| Phone / Desktop daily use | Undisturbed — phone stays primary | Depends on Desktop receiving media |
| Group identity | Real WhatsApp group **subject** → folder | Best-effort path/filename hints only |
| Chromium / Desktop install | Not required | WhatsApp Desktop required |
| Fragility | Needs spare Linked devices slot + auth on PC | Breaks when media root missing / opaque hashes |

---

## Destination (same as Draft UI)

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\<WhatsApp group name>\YYYY-MM-DD\
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\individual\YYYY-MM-DD\
```

Configured via `PHOTO_BACKUP_ROOT` (or mock when `USE_MOCK=true`). Day folders use **Asia/Hong_Kong**.

Folder naming (no keyword aliases):

| Chat | Backup folder |
| --- | --- |
| WhatsApp **group** | Live group **subject** (display name), sanitized for Windows/UNC; Chinese/Unicode kept |
| **1:1** / individual | `individual` |

Illegal path characters (`<>:"/\|?*` and controls) are replaced; trailing dots/spaces stripped. There is **no** `site-memo` / `unmapped` alias map — the on-disk folder is the group title itself.

The Draft UI lists **all** top-level folders under `Group_photo_backup` (group subjects + `individual`). Optionally set `PHOTO_GROUP` to pre-select one folder when it exists; otherwise pick group → day → photos in the UI. On the Windows PC set `USE_MOCK=false` so browse uses the live UNC root.

---

## Safety / ops rules

1. **Spare Linked devices slot** — WhatsApp caps linked devices; free a slot before linking.
2. **Phone stays primary** — this process is an extra linked device only; it does not take over the phone session.
3. **Desktop daily use undisturbed** — keep using WhatsApp Desktop for chat; this daemon only archives incoming photos and PDFs.
4. **Do not QR-link from cloud / this agent** — copy the repo to an always-on **Windows PC** and run `npm run wa-link` there.
5. **Never commit** `.wa-auth\` (session secrets), state, or heartbeat files.
6. **Incoming only** — outbound (`fromMe`) media is ignored; the daemon never sends messages.

---

## Windows run steps

### 1. Install on the Windows PC

```bat
git clone https://github.com/lanlhl2005-star/SM.git
cd SM
copy .env.example .env
```

Edit `.env` for the live share:

```env
USE_MOCK=false
PHOTO_BACKUP_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
```

```bat
node -v
npm install
```

Requires **Node.js 20.9+**. A `postinstall` patch rewrites Baileys JSON import attributes for Node 20.9.

### 2. Link once (QR)

On the phone: **WhatsApp → Settings → Linked devices → Link a device** (ensure a spare slot).

On the PC:

```bat
npm run wa-link
```

- A QR prints in the terminal **and** is written to `.wa-auth\qr.png` (open that PNG if the terminal QR is hard to scan).
- Scan the **latest** QR quickly. Status **515** during pairing is **normal** — wait for a fresh QR; do not delete `.wa-auth\` unless WhatsApp reports `loggedOut`.
- Wait up to **10 minutes**. Credentials persist under `.wa-auth\` — **do not commit or sync that folder to cloud shares.**

Pairing code alternative:

```bat
npm run wa-link -- --phone 85291234567
```

Then on the phone: **Linked devices → Link with phone number** → enter the printed code.

### 3. Run the daemon

```bat
npm run wa-backup
```

Leave it running (or register Task Scheduler **At log on** → `scripts\wa-run-daemon.cmd`). Optional health check every 10 minutes: `scripts\wa-healthcheck.cmd` / `npm run wa-backup:health`.

### 4. Verify

1. From another account (or a contact), send a photo into a project WhatsApp group.
2. Confirm a file appears under `Group_photo_backup\<that group’s subject>\YYYY-MM-DD\` (or `individual\YYYY-MM-DD\` for a 1:1 chat).
3. Restart `npm run wa-backup` — the same message must **not** duplicate (JSON state dedupe).

### Re-link after logout / switch WhatsApp number

Baileys stores the linked-device session under `.wa-auth\` (`useMultiFileAuthState`). There is **no** hardcoded phone for the normal QR flow. Optional `WA_LINK_PHONE` / `--phone` is only for the pairing-code alternative.

To unlink the current number and link a different one on the Windows PC:

1. Stop the daemon: in the `wa-backup` terminal press **Ctrl+C** (also stop Task Scheduler if it auto-starts `scripts\wa-run-daemon.cmd`).
2. On the **old** phone: **WhatsApp → Settings → Linked devices** → remove this PC’s linked device (if still listed).
3. Clear local auth (preferred):

```bat
npm.cmd run wa-logout
```

Or manually:

```bat
rmdir /s /q .wa-auth
rmdir /s /q .wa-backup-tmp
del /q .wa-backup-heartbeat.json
```

Optional clean dedupe file: `npm.cmd run wa-logout -- --clear-state` (or `del /q .wa-backup-state.json`). Do **not** delete `Group_photo_backup` — group/day folders stay as-is.

4. If `.env` has `WA_LINK_PHONE=...` for pairing-code link, update it to the new digits or comment it out for QR.
5. On the **new** phone: free a Linked devices slot, then:

```bat
npm.cmd run wa-link
```

Scan the latest QR (or `.wa-auth\qr.png`) with the **new** phone. Pairing code: `npm.cmd run wa-link -- --phone 852xxxxxxxx`.

6. Restart the daemon:

```bat
npm.cmd run wa-backup
```

The new account must be a member of the same WhatsApp groups for those group folders to receive new media. Draft UI (`npm start`) does not need a restart for the number switch.

### After updating the repo

```bat
git pull
npm.cmd run wa-backup
```

Restart the daemon after every pull so it picks up code changes (auth under `.wa-auth\` is kept — no re-link needed unless WhatsApp logged the device out).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EXDEV: cross-device link not permitted` when saving to a UNC `PHOTO_BACKUP_ROOT` | Fixed in current tree: media is moved with rename, falling back to copy-then-unlink across devices. `git pull` and restart `npm.cmd run wa-backup`. |
| `ERR_UNC_HOST_NOT_ALLOWED` / `UNC host 'server' access is not allowed` while PowerShell `Get-ChildItem` on the same UNC works | That error code is from **Electron/Cursor-patched** Node, not official `C:\Program Files\nodejs` (stock Node ignores `NODE_UNC_HOST_ALLOWLIST`). Reliable fix: `net use S: \\Server\Share`, set `SHARE_DRIVE=S:` (or `PHOTO_BACKUP_ROOT` / `SITE_MEMO_ROOT` under `S:\...`), `git pull`, restart. The app also auto-rewrites UNC → mapped drive when `SHARE_DRIVE` or `net use` already maps the share. |
| Chinese path segments (e.g. `火炭`) look garbled in the console | Usually console code-page mojibake only. Paths are UTF-16 JS strings and are written correctly on the share — check Explorer, not the terminal glyphs. |

---

## What gets saved

| Saved | Skipped |
| --- | --- |
| Incoming **image** and **PDF** (default `mediaTypes`: `["image","pdf"]`) from groups → `<group subject>\YYYY-MM-DD\` | Outgoing (`fromMe`) |
| Same for 1:1 → `individual\YYYY-MM-DD\` | Audio, stickers, PTT, non-PDF documents, video (unless you extend `mediaTypes`) |

Filename: caption (sanitized) → else original file stem → else `WA_<msgid>.ext`. Collisions → `name_2.ext`.

### Tags (per file)

Every newly saved photo/PDF gets:

| Tag | Source |
| --- | --- |
| **sender number** | Group participant JID or 1:1 chat JID (digits before `@`, device suffix stripped) |
| **sending date** | Message timestamp in `Asia/Hong_Kong` (`YYYY-MM-DD HH:mm:ss`) |
| **caption / message** | Media caption itself, plus same-sender text messages in the same chat within **±5 minutes** |

Stored as:

- `<file>.tags.json` next to the media (survives UNC)
- day-folder `tags.json` index (`{ "files": { "<name>": {…} } }`) for Draft UI search

**No backfill:** older files saved before this feature have no tags until new media arrives. Restart `npm run wa-backup` after pull so the daemon writes tags for new files.

Draft UI browse lists PDFs with a **PDF** badge (filterable by tags) but only **images** can be added to Site Memo photo blocks.

---

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run wa-link` | QR / pairing-code link once |
| `npm run wa-backup` | Persistent saver daemon |
| `npm run wa-backup:health` | Exit 0 if heartbeat fresh |
| `npm run wa-logout` | Clear `.wa-auth` (+ tmp/heartbeat) to switch number / re-link |
| `npm run backup-watch` | Deprecated Desktop-cache fallback |

---

## State & secrets (gitignored)

| Path | Purpose |
| --- | --- |
| `.wa-auth\` | Baileys multi-file credentials (**secret**) |
| `.wa-backup-state.json` | Dedupe by message key |
| `.wa-backup-heartbeat.json` | Daemon liveness for `health` |
| `.wa-backup-tmp\` | In-flight downloads |

---

## Related

- [whatsapp-media-saver](https://github.com/lanlhl2005-star/whatsapp-media-saver) — fuller archive (image/video/document + description.txt)
- [docs/whatsapp-desktop-backup-watch.md](whatsapp-desktop-backup-watch.md) — deprecated Desktop watcher
- [docs/whatsapp-manual-intake-plan.md](whatsapp-manual-intake-plan.md) — overall intake plan
