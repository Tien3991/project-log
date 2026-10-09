# Project Log

A small installable web app (PWA) for tracking progress across many projects on an Android phone.

- **Projects**: one row per project. The first column is the project; next to it is a horizontally scrolling timeline with one card per day that has updates, newest first. The small labels between cards show the gap ("3d", "2w"). Tap a project's name for its history and stats. That page can also move the project up, down, to the top or to the bottom, and archive or unarchive it.
- **Daily**: what you got done each day, grouped by project, with search.
- **Calendar**: a month heatmap with weekly totals, or a year view with 12 mini-months and a per-week chart. Each has a project × week (or month) table. "How much" means the number of updates. Use the dropdown, or tap a project in the table, to see a single project.

Everything is plain HTML/CSS/JavaScript with no build step and no dependencies. Data is stored in the browser's `localStorage` on the phone. It works offline and never leaves the device unless you export a backup.

## Install on Android

1. Open the hosted URL in **Chrome** on the phone.
2. Tap ⋮ → **Add to Home screen** → **Install** (or use Settings ⚙ → *Add Project Log to home screen* when it appears).
3. Long-press the home-screen icon for shortcuts: *Log an update*, *Daily*, *Calendar*.

Offline support and installing need HTTPS, so host the folder on GitHub Pages, Netlify, Cloudflare Pages or similar.

## Backups

Settings ⚙ → **Share backup** (to Google Drive, email, …) or **Download backup file**. **Restore from backup** can either merge a file into your current data or replace it. The app nudges you if you haven't backed up in two weeks.

On Android the shared file is named `.txt`, because the share sheet refuses `.json`. Restore accepts both.

## Run locally

```bash
python3 -m http.server 8790
```

Then open http://localhost:8790. The service worker is skipped on plain-http hosts so edits show up immediately; add `?sw` to the URL to test offline mode.

## Releasing a change

The service worker serves every file from its cache. **After changing any file, bump `VERSION` in `sw.js`**. Otherwise installed copies keep the old version. The next time the app opens online, it fetches the new files and shows "A new version is ready — Reload". If you add a new file, also add it to `ASSETS` in `sw.js`.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | App shell: top bar, tab bar, add button |
| `css/app.css` | All styles, light and dark themes |
| `js/app.js` | Routing between tabs, click actions, theme, service worker registration |
| `js/store.js` | Data model, persistence, ordering, backup import/export, sample data |
| `js/dates.js` | Local-date helpers (`YYYY-MM-DD` keys) and labels |
| `js/ui.js` | Bottom sheets (with Android back-button support), toasts, escaping |
| `js/components.js` | Shared markup: day summary, colour swatches, heat levels |
| `js/sheets.js` | Log/edit update, project form, project history, day details, settings |
| `js/views/*.js` | The Projects, Daily and Calendar tabs |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |
