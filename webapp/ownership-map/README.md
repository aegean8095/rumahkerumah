# Ownership Map (standalone web app)

Static version of the Ownership Map artifact, built to run from GitHub Pages. No build step.

- `index.html` is the app. `rk-shim.js` replaces the claude.ai artifact runtime, `rk-github.js` syncs the dataset with GitHub, `rk-backup.js` adds the backup and GitHub buttons.
- **GitHub is the main copy.** The dataset lives in `ownership-map/dataset.json` on the data-only branch `ownership-map-data`. The app loads it when it opens (no token needed, the repo is public) and, once connected, saves it about 8 seconds after every change (one commit per save). Every save is in the branch history and can be restored from there.
- **Connecting** (once per browser or device): Dataset panel → *Connect GitHub* and paste a fine-grained personal access token with access to `rumahkerumah` only and *Contents: Read and write*. The token stays in the browser's localStorage.
- **Two devices**: if both changed the dataset, the app asks which version to keep; the one not kept is downloaded as a backup file first.
- **Data** is also kept per browser in IndexedDB as the working copy (it keeps working offline and saves to GitHub later). Open tabs of the same browser stay in sync. The app asks the browser for persistent storage on the first edit (the browser decides whether to grant it).
- **Seed**: `data/seed.json` is only used when GitHub can't be reached or the data branch doesn't exist yet, on the very first visit in a browser. A dataset you empty stays empty. It is built from `shadow-corporate/cSPKaltim.csv` by `python3 shadow-corporate/build_seed.py` (run from the repo root).
- **Back up / restore**: Dataset panel → *Back up dataset* downloads one JSON file (entities, relationships, history). *Restore from backup* replaces the dataset in this browser with such a file. A backup file can also be committed as `data/seed.json`.
- **Tabs**: *Map*, *Table* (Entities and Relationships, sortable, filterable, CSV) and *Data quality* (incomplete data, possible duplicates, gaps in the group network, possible errors, profiles to update). Findings can be marked Checked or Ignored with a note; marks are saved with the dataset.
- **Reading the map**: hover an entity to light up its neighbourhood. Shift+click (or Ctrl/Cmd+click) selects several entities, Shift+drag draws a box; the bar offers Focus, Hide, Assign group and, for two entities, Find connection. The calendar button in the zoom toolbar opens the *as of* slider (the structure in a given month, estimated from the dates in the documents). The save chip at the top shows whether the dataset is safe on GitHub.
- **Find connection** (toolbar, selection bar or an entity's detail): shortest chains of shareholdings and board roles between two entities, with the indirect stake.
- **Company report**: in a company's detail, *Company report* opens a printable summary; *Print / Save as PDF* prints only the report.
- **CSV / PNG export** work as normal browser downloads.
- **Read a company profile PDF** uses the DeepSeek API (`deepseek-chat`), called straight from the browser. The first time, the page asks for your API key; it is kept in this browser's localStorage only, never in the repo. Remove it with `rumahkerumahAI.clearKey()` in the console. The document's text is sent to DeepSeek. Only PDFs with selectable text work; scans and photos must be pasted by hand.
- **Note on keys**: localStorage belongs to the whole `aegean8095.github.io` domain, so other GitHub Pages sites of this account could read the DeepSeek key and the GitHub token. Keep the token limited to this repo's contents.
- Console helpers: `rumahkerumahDB.export()`, `.import(obj)`, `.replace(obj)`, `.reset()` (clears this browser and reloads from GitHub).

## Tests
`node webapp/ownership-map/tests/run.js` (from the repo root; needs Playwright + Chromium). Fakes GitHub and DeepSeek; pass a word to run only matching tests, e.g. `github`.

## Publish on GitHub Pages
Settings → Pages → Deploy from a branch → this branch, folder `/ (root)`.
The app is then at `https://aegean8095.github.io/rumahkerumah/webapp/ownership-map/`.
