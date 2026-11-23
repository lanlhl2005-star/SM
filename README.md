# Site Memo (SM)

Local web UI for **LK-P01043** site memos: browse WhatsApp group photo backups, group photos into ordered `photo_blocks` with captions, fill date/subject/body, and write an unlocked editable **Draft** `.doc` under the Site Memo share.

**Primary photo intake:** Baileys **linked-device** backup (`npm run wa-link` / `npm run wa-backup`) saves incoming **photos and PDFs** into `Group_photo_backup\<WhatsApp group name>\YYYY-MM-DD\` (1:1 chats → `individual\YYYY-MM-DD\`) without disturbing phone or Desktop daily use. Each saved file gets durable tags (sender number, send date/time, nearby caption/message within ±5 minutes). The Draft UI can filter browse by those tags; PDFs are browse/filter-only (not embeddable in memo photo blocks). The older Desktop media-cache watcher is optional/deprecated. Send-to-WhatsApp is **out of scope** (on hold).

## Quick start (Windows colleagues)

```bat
git clone https://github.com/lanlhl2005-star/SM.git
cd SM
copy .env.example .env
npm install
npm start
```

Open **http://127.0.0.1:3847** in a browser.

Default Draft UI port is **3847** (`config/default.json`); override with `PORT` in `.env` if needed. The `tunnel` script below targets `127.0.0.1:3847` — if you change `PORT`, point cloudflared at the same port.

### Draft UI password (recommended before tunnel)

By default the Draft UI is **open** when `DRAFT_UI_PASSWORD` (or alias `UI_PASSWORD`) is unset/empty — fine for local-only use on `127.0.0.1`.

When exposing the UI (especially via Cloudflare quick tunnel), set a password in **local** `.env` only (do not commit the real value):

```env
DRAFT_UI_PASSWORD=your-secret-here
```

Then **restart** Draft UI (`Ctrl+C`, then `npm start`) so the gate loads. On startup the console prints `auth: ON (… password length N)` or `auth: OFF`, plus the absolute `.env` path — confirm **ON** before sharing a tunnel URL. With a password set, every HTML page, static asset, and `/api/*` route (except public `/api/auth-status`) requires sign-in (HttpOnly cookie after `/login`; Cloudflare HTTPS sets the `Secure` flag). Do not leave a blank `DRAFT_UI_PASSWORD=` line above the real value in `.env`.

If the Draft UI opens **without** a login form while the console says `auth: ON`, the browser still has a session cookie (common after an earlier tunnel visit). Sign out with **Sign out** in the header, open `/logout`, or add `?logout=1` to the URL. Changing the password also invalidates old cookies.

Quick check (Windows or any host):

```bat
npm run check:auth
```

### Share Draft UI over the internet (Cloudflare quick tunnel)

1. Set `DRAFT_UI_PASSWORD` in `.env` and restart `npm start` (confirm `auth: ON`).
2. In another terminal:

```bat
npm run tunnel
```

Copy the printed `https://….trycloudflare.com` URL from the cloudflared output. Open it — you should see the login page (use a private window if an old cookie is stuck). Keep the tunnel running while colleagues use the link. Press **Ctrl+C** to stop the tunnel. No Cloudflare account is required for quick tunnels (`npx` downloads `cloudflared` on demand).

### Photo backup — Baileys linked device (primary)

Run on an always-on **Windows PC** (not in the cloud). Needs a spare **Linked devices** slot; phone stays primary.

```bat
npm run wa-link
npm run wa-backup
```

- `wa-link` — scan QR once (or `npm run wa-link -- --phone 852…`); credentials under `.wa-auth\` (**gitignored**, never commit).
- `wa-backup` — daemon; incoming photos **and PDFs** → `PHOTO_BACKUP_ROOT\<group subject>\YYYY-MM-DD\` (or `individual\YYYY-MM-DD\`), with `.tags.json` sidecars + day `tags.json`.
- `wa-logout` — clear `.wa-auth\` (and tmp/heartbeat) to unlink / switch WhatsApp number, then `wa-link` again. See [docs/whatsapp-baileys-backup.md](docs/whatsapp-baileys-backup.md#re-link-after-logout--switch-whatsapp-number).

**After every `git pull`:** restart `wa-backup` (Ctrl+C, then `npm run wa-backup`) and restart Draft UI (`npm start`) so new PDF/tag/filter code loads. Auth under `.wa-auth\` is kept — no re-link unless WhatsApp logged the device out. **Tags apply only to newly saved files** (no backfill of older backups).

Full steps, Task Scheduler tips, and safety rules: [docs/whatsapp-baileys-backup.md](docs/whatsapp-baileys-backup.md).

### Photo backup — Desktop watcher (optional / deprecated)

Fragile when the Desktop media root is missing. Prefer Baileys above.

```bat
npm run backup-watch
npm run backup-watch:once
```

Details: [docs/whatsapp-desktop-backup-watch.md](docs/whatsapp-desktop-backup-watch.md).

### Point at the live shares

Edit `.env` (or set environment variables). Default is **LIVE** (`USE_MOCK` unset or `false`) using the UNC roots in `config/default.json`. Keep `USE_MOCK=false` in `.env` on the Windows PC so Draft UI shows real WhatsApp backups (not coloured mock samples).

**Prefer a mapped drive** (works on stock `C:\Program Files\nodejs` and every other Node build):

```bat
net use S: \\Server\Share
```

```env
USE_MOCK=false
SHARE_DRIVE=S:
PHOTO_BACKUP_ROOT=S:\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
SITE_MEMO_ROOT=S:\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

If `PHOTO_*` / `SITE_*` still use `\\Server\Share\...`, the app rewrites them to `S:\...` when `SHARE_DRIVE=S:` is set or when `net use` already maps that share.

Raw UNC also works on official nodejs.org builds when the share is reachable:

```env
USE_MOCK=false
PHOTO_BACKUP_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup
SITE_MEMO_ROOT=\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Site Memo
```

**About `ERR_UNC_HOST_NOT_ALLOWED`:** that error is from **Electron/Cursor-patched** Node, not from official nodejs.org. `NODE_UNC_HOST_ALLOWLIST` is ignored by stock Node. If you see that error, map the share (above) — do not rely on the allowlist alone.

Optional: set `PHOTO_GROUP` to a top-level folder name under `Group_photo_backup` (live WhatsApp group subject, or `individual`) to pre-select it in the UI. Leave unset to pick from the folder list.

Requires **Node.js 20.9+**.

## Mock / cloud fallback

Mock is **opt-in only**: set `USE_MOCK=true` explicitly (offline / cloud smoke). Unset or `false` always uses live UNC from `config/default.json` (or `PHOTO_*` / `SITE_*` overrides) — no auto-fallback when the share is invisible from this machine.

```text
mock/Group_photo_backup/<group>/YYYY-MM-DD/   ← group = subject folder or individual
mock/Site Memo/                               ← Draft folders written here
mock/WhatsAppDesktop/media/                   ← backup-watch source in mock mode
```

If `.env` is missing, `npm start` logs a loud warning and still defaults to LIVE.

Smoke-test without the UI (scripts set `USE_MOCK=true`):

```bat
npm run smoke
npm run smoke:backup
npm test
```

> Do **not** run `npm run wa-link` on a cloud agent — link only on the Windows PC that will host the daemon.

## UI flow

1. Choose a **group folder** under `…\Group_photo_backup\` (live WhatsApp group subject, or `individual`), then a **day** (`YYYY-MM-DD`).
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
| Output | Unlocked editable `.doc` (Word HTML with `data:image` embeds; Calibri 12; SM-005 bordered photo tables; closing/sign-off after photos) |

## Server paths (live)

**Photo backup (browse):** every top-level folder under `Group_photo_backup` (Baileys uses the live WhatsApp group subject, or `individual` for 1:1). Example:

```text
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\<group subject>\YYYY-MM-DD\
\\Server\Share\Sang\project\new project 2026\cmi 火炭 MVAC\Group_photo_backup\individual\YYYY-MM-DD\
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
npm run draft -- --subject "14F Diversion" --short "14F Diversion" --image site-memo/2026-11-18/IMG_stair_clash.jpg --caption "Photo of Steel stair"
```

## License / ownership

Internal project tooling for Lap Kei Engineering site memos on LK-P01043.
