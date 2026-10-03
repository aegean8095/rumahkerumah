# CLAUDE.md

Central log for all work done with Claude Code on this repository.

## Project Overview

**rumahkerumah** is a research data repository tracking Indonesian wood and pulp supply chains, deforestation, environmental impacts, and corporate accountability.

## Repository Structure

```
rumahkerumah/
├── CLAUDE.md                              # This file - central log
│
├── pulpwood-supply-chain/                 # 1) Pulpwood supply chain data
│   ├── Documentation.csv                  #    Field-level metadata
│   ├── indonesia_wood_pulp_v3_1_0.csv     #    Master dataset (v3.1.0)
│   ├── iwp3_2015.csv ~ iwp3_2022.csv      #    Yearly supply chain data
│   ├── iwp3_2015err.csv                   #    Error records for 2015
│   ├── Trase-Export-2015 - Sheet1.csv     #    Pulp export data (2015)
│   ├── Trase-Export-2016 - 2016.csv       #    Pulp export data (2016)
│   ├── Trase-Export - 2017.csv ~ 2024.csv #    Pulp export data (2017-2024)
│   └── Trase2025.csv                      #    Pulp export data (2025)
│
├── shadow-corporate/                      # 2) Shadow corporate intelligence
│   └── cSPKaltim.csv                      #    Shareholding & directorships (Kaltim)
│
├── deforestation-risk/                    # 3) Deforestation risk monitoring
│   ├── 02i2025n.csv                       #    Deforestation news/incidents 2025
│   └── 02i2025r.csv                       #    Deforestation research data 2025
│
├── webapp/                                # 6) Static web apps for GitHub Pages
│   └── ownership-map/                     #    Ownership Map (index.html + rk-*.js); data on branch ownership-map-data
│
├── research-and-second-brain/             # 4) Research notes & second brain
│
└── personal/                              # 5) Personal workspace
```

### Folder Descriptions

| # | Folder | Purpose |
|---|--------|---------|
| 1 | `pulpwood-supply-chain/` | Trase export data, iwp3 supply chain datasets, and the master wood & pulp database. Tracks volumes, mills, importers, emissions, and concession-level metrics (2015-2025). |
| 2 | `shadow-corporate/` | Corporate intelligence — shareholding structures, directorships, and company linkages. Currently focused on East Kalimantan concessions. |
| 3 | `deforestation-risk/` | Deforestation incident tracking and case reports. Active monitoring of 2025 events. |
| 4 | `research-and-second-brain/` | Research notes, analysis, references, and knowledge base. |
| 5 | `personal/` | Personal workspace and notes. |

## Session Log

### 2026-02-04 — Initial setup

- Explored the full repository structure and all 25 CSV data files
- Created this `CLAUDE.md` as the central index for Claude Code work
- No existing documentation (README, LICENSE, .gitignore) was present prior to this

### 2026-02-04 — Repository restructuring

- Reorganized flat file structure into 5 thematic folders
- Moved 22 CSV files into appropriate directories:
  - `pulpwood-supply-chain/` — Trase exports (2015-2025), iwp3 data (2015-2022), master dataset, Documentation
  - `shadow-corporate/` — cSPKaltim corporate linkage data
  - `deforestation-risk/` — 02i2025n and 02i2025r incident/research data
- Created empty `research-and-second-brain/` and `personal/` folders for future use

### 2026-10-02 — Ownership Map web app

- Converted the Ownership Map artifact into a standalone static app in `webapp/ownership-map/`
- `rk-shim.js` replaces the artifact runtime: db → IndexedDB (optional seed `data/seed.json`), downloads → browser download (PDF reading was added later via DeepSeek, see below)
- Tested in Chromium (map draws, data persists after reload). See `webapp/ownership-map/README.md` for Pages setup

### 2026-10-02 — Ownership Map seed data

- Added `shadow-corporate/build_seed.py`: builds `webapp/ownership-map/data/seed.json` from `cSPKaltim.csv` (165 entities, 235 relationships, group `Kaltim`)
- Row 229 (PT Sylvaduta, Pieter Tanuri) is typed DIRECTORSHIP but titled MINORITY SHAREHOLDER 1%; the seed treats it as a stake. Source CSV left unchanged
- Tenure start/end dates become the relationship's seen dates (month precision)

### 2026-10-02 — Ownership Map PDF reading via DeepSeek

- `rk-shim.js` now implements the `sample` capability with the DeepSeek chat API (browser → api.deepseek.com, CORS allowed for the Pages origin)
- The API key is entered in the browser (localStorage), never committed. Text PDFs only; scans are unsupported
- Tested with a generated PDF and a mocked API response; not tested against the live DeepSeek API

### 2026-10-02 — Ownership Map review fixes

- Seed loads on the first visit only (flag `_meta/seeded` in IndexedDB); an emptied dataset no longer comes back
- Open tabs sync through BroadcastChannel; persistent storage requested on first edit
- Dataset panel: *Back up dataset* / *Restore from backup* buttons (`rk-backup.js`), with last-backup note
- UI text no longer mentions Claude or a shared dataset; PDF picker accepts PDFs only, clearer message for scans
- `.nojekyll` moved to the repo root (Pages serves the root)
- Tested in Chromium: seed once, tab sync, backup/restore, add + undo, PDF flow with mocked API

### 2026-10-03 — Ownership Map saves to GitHub

- New `rk-github.js`: the dataset is kept in `ownership-map/dataset.json` on the data-only branch `ownership-map-data` (orphan branch, created with the seed data)
- Loaded on open without a token; saved ~8 s after each change with a fine-grained token (Contents: read/write on this repo) entered in the browser
- Conflicts between devices are detected (blob sha); the user picks a version and the other one is downloaded as a backup
- Dataset panel: "Saved on GitHub" block (status, Connect / Save now / Disconnect, links to the file and its history)
- Tested in Chromium against a mocked GitHub API: fresh load, autosave, two tabs, another device, both conflict choices, missing branch, bad token

---

## Notes

- The master dataset `indonesia_wood_pulp_v3_1_0.csv` and `Documentation.csv` are the largest files (~17 MB each)
- Trase export files cover 2015-2025 with consistent schema across years
- `iwp3` files track supply chain details including deforestation, emissions, concession areas
- Active data collection ongoing — `02i2025*.csv` files are updated regularly
