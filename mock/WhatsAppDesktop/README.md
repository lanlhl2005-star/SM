# Mock WhatsApp Desktop media cache

Used when `USE_MOCK=true` and `WA_DESKTOP_MEDIA_ROOT` is unset.
Subfolders named like `site-memo` / `material-delivery` exercise Desktop watcher group mapping
(Baileys live backups use WhatsApp subject folders + `individual/` instead);
loose files at the media root land in `unmapped`.

