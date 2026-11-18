# Mock Group_photo_backup

Offline smoke layout matches live Baileys backups:

```text
<group subject or alias>/YYYY-MM-DD/<photos>
individual/YYYY-MM-DD/<photos>
```

- `site-memo/` — sample photos for Draft UI / `npm run smoke` (also Desktop-watcher alias)
- `LK Site Memo Sample/` — second group folder to exercise group picker
- `individual/` — 1:1 chat sample

With `USE_MOCK=true` (explicit), Draft UI lists these top-level folders. Default / `USE_MOCK=false` is LIVE UNC from `config/default.json`.
