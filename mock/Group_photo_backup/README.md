# Mock Group_photo_backup

Offline smoke layout matches live Baileys backups:

```text
<group subject or alias>/YYYY-MM-DD/<photos and PDFs + *.tags.json>
individual/YYYY-MM-DD/<photos and PDFs + *.tags.json>
```

- `site-memo/` — sample photos + a sample PDF (`sample_delivery.pdf`) with tags for Draft UI filters / `npm run smoke`
- `LK Site Memo Sample/` — second group folder to exercise group picker
- `individual/` — 1:1 chat sample

With `USE_MOCK=true` (explicit), Draft UI lists these top-level folders. Default / `USE_MOCK=false` is LIVE UNC from `config/default.json`.
