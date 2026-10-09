# Project Log

A small installable web app (PWA) for tracking progress across many projects on an Android phone, iPad or any browser.

- **Projects**: one row per project. The first column is the project; next to it is a horizontally scrolling timeline with one card per day that has updates, newest first. The small labels between cards show the gap ("3d", "2w"). Tap a project's name for its history and stats. That page can also move the project up, down, to the top or to the bottom, and archive or unarchive it.
- **Daily**: what you got done each day, grouped by project, with search.
- **Calendar**: a month heatmap with weekly totals, or a year view with 12 mini-months and a per-week chart. Each has a project × week (or month) table. "How much" means the number of updates. Use the dropdown, or tap a project in the table, to see a single project.
- **Profiles**: separate sets of projects, for example one per job. Switch by tapping the profile name in the top bar.
- **Sync** (optional): keeps your phone, iPad and other devices in step through a private GitHub repository.

Everything is plain HTML/CSS/JavaScript with no build step and no dependencies. Each device keeps its data in the browser's `localStorage` and works offline. Data leaves the device only if you turn on sync or export a backup.

## Install on Android

1. Open the hosted URL in **Chrome** on the phone.
2. Tap ⋮ → **Add to Home screen** → **Install** (or use Settings ⚙ → *Add Project Log to home screen* when it appears).
3. Long-press the home-screen icon for shortcuts: *Log an update*, *Daily*, *Calendar*.

On an **iPad or iPhone**, open the URL in Safari, then tap Share → **Add to Home Screen**. Always open it from the home-screen icon: Safari may clear data for websites you haven't visited in a week, but home-screen apps are exempt.

Offline support and installing need HTTPS, so host the folder on GitHub Pages, Netlify, Cloudflare Pages or similar.

## Sync

Settings ⚙ → **Sync**. You need two things:

1. A **private** GitHub repository for the data, for example `project-log-data`.
2. A [fine-grained access token](https://github.com/settings/personal-access-tokens/new). Set *Repository access* to *Only select repositories* and pick the data repository. Under *Permissions → Repository permissions*, set *Contents* to *Read and write*.

Enter both on each device. The data lives in `project-log.json` in that repository. Every sync that changes something is a commit, so the repository history is also a version history.

How it works:
- Each device keeps a full local copy and syncs a few seconds after each change, when the app opens or regains focus, every few minutes while it's open, and when the connection comes back.
- Copies merge record by record. The newest edit of each entry wins, and deletions are kept as tombstones, so changes made offline on several devices combine.
- The token is stored only on the device that uses it. Turning sync off keeps local data and leaves the repository untouched.

## Backups

Settings ⚙ → **Share backup** (to Google Drive, email, …) or **Download backup file**. A backup contains all profiles. **Restore from backup** can either merge a file into your current data or replace it. Old single-profile backups restore into the current profile. The app nudges you if you haven't backed up in two weeks.

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
| `js/store.js` | Data model, profiles, persistence, merging, ordering, backup import/export, sample data |
| `js/sync.js` | GitHub sync: read, merge, write, retry, status |
| `js/dates.js` | Local-date helpers (`YYYY-MM-DD` keys) and labels |
| `js/ui.js` | Bottom sheets (with Android back-button support), toasts, escaping |
| `js/components.js` | Shared markup: day summary, colour swatches, heat levels |
| `js/sheets.js` | Log/edit update, project form, project history, day details, profiles, sync setup, settings |
| `js/views/*.js` | The Projects, Daily and Calendar tabs |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |
