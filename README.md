# Penny Plan

A simple, private budgeting app for students. Runs in the browser, installs to the iPhone/Android home screen,
works offline, and keeps all data **on the device** (IndexedDB). No accounts, servers, or tracking.

## What it does
- **Home** – live "left to spend" for the month (income − spent − saved), spend-per-day, category bars with optional limits, savings goal with a one-tap "move the leftover to savings".
- **Add** – expense / income / savings with date, payee or source, category (remembers the category per payee), "repeats every month" for rent, paychecks, subscriptions. The sheet shows what will be left *before* you save.
- **History** – month by month, filter and search, tap to edit or delete.
- **Savings** – target % of income, streak, goals with progress, emergency-cushion meter, "future you" compounding slider, badges, weekly challenge.
- **Insights** – 3 / 6 / 12 months / all time: income vs. spending, left-over per month, income and spending trends, top categories (vs. previous period), top places, needs/wants/waste, income sources, weekday pattern, "spending leaks", and rule-based **ways to spend less** (phone, internet, utilities, insurance, subscriptions, dining, coffee, fees…) with estimated monthly savings.
- **Backup** – Settings → *Back up now* opens the phone's share sheet; choose **Save to Files → iCloud Drive** (or Google Drive, email, AirDrop). *Restore* loads the file back. CSV export for spreadsheets. A banner reminds people to back up.

## Files
`index.html`, `app.js`, `style.css`, `sw.js` (offline cache), `manifest.webmanifest`, `icons/`. No build step, no dependencies.
`tools/make_icons.py` regenerates the icons (`python3 tools/make_icons.py`).

## Run locally
```bash
cd penny-plan && python3 -m http.server 8610
# open http://localhost:8610
```

## Host on GitHub Pages
1. Create a new **public** repo on GitHub (e.g. `penny-plan`). The app has no private data in it.
2. Push this folder:
   ```bash
   cd penny-plan
   git init && git add . && git commit -m "Penny Plan"
   git branch -M main
   git remote add origin https://github.com/<you>/penny-plan.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
4. After a minute it is live at `https://<you>.github.io/penny-plan/`.

All paths are relative, so it works under the `/penny-plan/` subfolder.

## Install on iPhone
Open the link in **Safari** → Share → **Add to Home Screen**. (Use the home-screen icon from then on; iOS can clear
website data for sites only used inside Safari tabs, but not for installed home-screen apps.)

## Updating
Edit files, push to GitHub. Online users get the new version next launch (the service worker is network-first).
Bump `VERSION` in `sw.js` if you ever need to force-clear the offline cache.
Existing users keep their data across updates. If you change the data shape, add a migration in `norm()` in `app.js`.
