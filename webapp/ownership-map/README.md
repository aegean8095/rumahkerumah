# Ownership Map (standalone web app)

Static version of the Ownership Map artifact, built to run from GitHub Pages. No build step.

- `index.html` is the app. `rk-shim.js` replaces the claude.ai artifact runtime; `rk-backup.js` adds the backup buttons.
- **Data** is stored per browser in IndexedDB. Open tabs of the same browser stay in sync. The app asks the browser for persistent storage on the first edit (the browser decides whether to grant it).
- **Seed**: `data/seed.json` is loaded on the very first visit in a browser only. A dataset you empty stays empty. It is built from `shadow-corporate/cSPKaltim.csv` by `python3 shadow-corporate/build_seed.py` (run from the repo root).
- **Back up / restore**: Dataset panel → *Back up dataset* downloads one JSON file (entities, relationships, history). *Restore from backup* replaces the dataset in this browser with such a file. A backup file can also be committed as `data/seed.json`.
- **CSV / PNG export** work as normal browser downloads.
- **Read a company profile PDF** uses the DeepSeek API (`deepseek-chat`), called straight from the browser. The first time, the page asks for your API key; it is kept in this browser's localStorage only, never in the repo. Remove it with `rumahkerumahAI.clearKey()` in the console. The document's text is sent to DeepSeek. Only PDFs with selectable text work; scans and photos must be pasted by hand.
- **Note on the key**: localStorage belongs to the whole `aegean8095.github.io` domain, so other GitHub Pages sites of this account could read the key.
- Console helpers: `rumahkerumahDB.export()`, `.import(obj)`, `.replace(obj)`, `.reset()` (clears everything and reloads the seed).

## Publish on GitHub Pages
Settings → Pages → Deploy from a branch → this branch, folder `/ (root)`.
The app is then at `https://aegean8095.github.io/rumahkerumah/webapp/ownership-map/`.
