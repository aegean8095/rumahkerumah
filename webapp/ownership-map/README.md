# Ownership Map (standalone web app)

Static version of the Ownership Map artifact, built to run from GitHub Pages. No build step.

- `index.html` is the app. `rk-shim.js` replaces the claude.ai artifact runtime.
- **Data** is stored per browser in IndexedDB. If the store is empty, the app loads `data/seed.json` (optional).
- **Seed data** `data/seed.json` is built from `shadow-corporate/cSPKaltim.csv` by `python3 shadow-corporate/build_seed.py` (run from the repo root; rerun after the CSV changes). It only loads in a browser whose store is empty; to reload it, run `rumahkerumahDB.reset()` in the console (this erases that browser's edits).
- **Share or back up data**: in the browser console run `copy(JSON.stringify(rumahkerumahDB.export()))`, save the result as `data/seed.json`, commit it. `rumahkerumahDB.import(obj)` and `rumahkerumahDB.reset()` also exist.
- **CSV / PNG export** work as normal browser downloads.
- **Read a company profile PDF** needs Claude and is not available here. Paste rows by hand instead.

## Publish on GitHub Pages
Settings → Pages → Deploy from a branch → choose the branch and the `/webapp` folder (or `/ (root)` and open `/webapp/ownership-map/`).
The app is then at `https://<user>.github.io/rumahkerumah/ownership-map/`.
