# WhatsApp Baileys linked-device photo backup

**Primary** intake path for LK-P01043 Site Memo photos. Uses [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) as a **linked device** (WebSocket — **no Chromium**). Incoming photos land in the same `Group_photo_backup` tree the Draft UI reads.

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
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\<group>\YYYY-MM-DD\
```

Configured via `PHOTO_BACKUP_ROOT` (or mock when `USE_MOCK=true`). Day folders use **Asia/Hong_Kong**.

Default groups: `site-memo`, `material-delivery`, `internal`, `bim-coordination`, plus fallback `unmapped`.

Group subject → folder mapping lives in `config/default.json` → `whatsappBaileys.groupMap.<folder>.matchNames`. Edit aliases to match the **exact WhatsApp group titles** on the phone.

---

## Safety / ops rules

1. **Spare Linked devices slot** — WhatsApp caps linked devices; free a slot before linking.
2. **Phone stays primary** — this process is an extra linked device only; it does not take over the phone session.
3. **Desktop daily use undisturbed** — keep using WhatsApp Desktop for chat; this daemon only archives incoming photos.
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

1. From another account (or a contact), send a photo into a mapped project group.
2. Confirm a file appears under `Group_photo_backup\<group>\YYYY-MM-DD\`.
3. Restart `npm run wa-backup` — the same message must **not** duplicate (JSON state dedupe).

### Re-link after logout

```bat
rmdir /s /q .wa-auth
npm run wa-link
```

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
| Chinese path segments (e.g. `火炭`) look garbled in the console | Usually console code-page mojibake only. Paths are UTF-16 JS strings and are written correctly on the share — check Explorer, not the terminal glyphs. |

---

## What gets saved

| Saved | Skipped |
| --- | --- |
| Incoming **image** (default `mediaTypes`) | Outgoing (`fromMe`) |
| | Audio, stickers, PTT (and video/document unless you extend `mediaTypes`) |
| | 1:1 chats → `unmapped\YYYY-MM-DD\` (or configure as needed) |

Filename: caption (sanitized) → else original file stem → else `WA_<msgid>.ext`. Collisions → `name_2.ext`.

---

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run wa-link` | QR / pairing-code link once |
| `npm run wa-backup` | Persistent saver daemon |
| `npm run wa-backup:health` | Exit 0 if heartbeat fresh |
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
