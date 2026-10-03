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

## Ownership Map — read this before touching `webapp/ownership-map/`

**Do not read `index.html` whole** (~345 kB, ~6,200 lines). Find the part you need with
`grep -n "^  // ----" webapp/ownership-map/index.html` (section headers) or `grep -n "function NAME"`, then read only that range.

Files:
| File | What it is |
|---|---|
| `index.html` | The original artifact (map, panels, parsing, editing, history, checks, PDF review). Change it as little as possible. |
| `rk-shim.js` | Replaces the claude.ai runtime: `db` (IndexedDB, tab sync), `downloads`, `sample` (DeepSeek). |
| `rk-github.js` | GitHub sync of the dataset (branch `ownership-map-data`, file `ownership-map/dataset.json`). |
| `rk-backup.js` | Back up / restore buttons and the "Saved on GitHub" block. |
| `rk-tabs.js` + `rk-tabs.css` | Map / Table tabs: Entities and Relationships tables (sort, search, CSV, row → detail panel or map). `window.OwnershipMapTabs.add()` lets other modules add a tab. |
| `rk-quality.js` | Data quality tab: 5 categories of findings, Checked / Ignore / note marks (collection `reviews`, synced), worklist CSV. Styles in `rk-tabs.css`. |
| `rk-map.js` | Hover highlight of an entity's neighbourhood, pinned highlight (`OwnershipMapHL`), multi-select (Shift/Ctrl-click, Shift-drag box) with the action bar (Focus, Hide, Assign group, Find connection). |
| `rk-connect.js` | Connection finder: shortest relationship chains between two entities, indirect stake, show on map (`OwnershipMapConnect.open`). |
| `rk-detail.js` | Entity detail additions: Focus buttons, Open in table, Find connection, Company report; Note block moved up. |
| `rk-time.js` | "As of" month slider (`OM.setAsOf`): structure in force in a month, estimated from dates seen. |
| `rk-report.js` | Printable company report (`OwnershipMapReport.open`), print CSS in `rk-ui.css`. |
| `rk-status.js` | Save status chip in the top capsule (Saved / Saving / Unsaved / Offline / Not connected). |
| `rk-profile.js` | Detail panel block "Profile": country (jurisdiction), address, identity registry numbers (`identities[{kind, number}]` on the entity). Table columns, Entities CSV, search, report and merge read the same fields. |
| `rk-stats.js` | Statistics tab: overview, data coverage, ownership concentration, who controls most, largest beneficial owners, boards, most connected, groups, countries, relationships by year first seen. Follows the map filters (like Table); names open the detail panel; Statistics CSV. |
| `rk-fold.js` | Sidebar panels fold to their heading on click / Enter / Space; remembered per browser (`om-folded-panels`); `OwnershipMapFold.open(id)`. |
| `rk-ui.css` | Styles for the modules above. |
| `tests/run.js` | Browser tests with fake GitHub and DeepSeek: `node webapp/ownership-map/tests/run.js [name-filter]`. |
| `data/seed.json` | Fallback data (built by `shadow-corporate/build_seed.py`). |

Sections of `index.html` (search the header text): DOM (`els.*` lookups), Parsing (`parse`, `nameKey`, `inferType`, `canonRole`),
Graph state (`graph`, `linkEnds`), Layout / filters, Detail panel (`selectNode`), Navigation (`focusNode`, `centerOnNode`),
Shared master dataset (`master`, `entityName`, `linkKey`, `graphFromMaster`, `scheduleMasterRefresh`), Writing (`commitChanges`, `withBusy`),
Import (`importRows`), Edit forms (`mergeEntities`), History, CSV export, Checks (`renderChecks`, `looseKey`), Sources overview,
Reading a company profile PDF (`readDocument`, `EXTRACT_PROMPT`), Start-up (`initMaster`), Add-on API.

**New features go in their own `rk-*.js` file**, loaded after the main script, using `window.OwnershipMap`
(read-only `master`, `graph`, `ready`, filters, plus `entityName`, `focusNode`, `selectNode`, `selectLink`, `mergeEntities`,
`commitChanges`, `focusOnSet`, `hideMany`, `setAsOf`, `fullGraph` (whole dataset, no filters), …; see "Add-on API" at the end of the main script). Redraw on the `om:change` event on `document`.
Only add a line to that API object when a feature needs something new.

Working efficiently (token use):
- Work one plan phase per session; agree open decisions before starting so nothing is redone.
- Run `tests/run.js` (or a filtered part) instead of writing throwaway test scripts; add a test there for each new feature.
- Routine edits (copy, a column, logs) are fine on Sonnet; keep Opus for design and hard bugs.
- Update Notion (page "Ownership Map — Catatan Status") and this log once, at the end of a session.

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

### 2026-10-03 — Token-saving groundwork for Ownership Map work

- Added the "Ownership Map — read this before…" section above: code map, file roles, working rules
- `index.html`: add-on API `window.OwnershipMap` and an `om:change` event (fired after data or map changes), so new features can live in separate `rk-*.js` files
- `tests/run.js`: one permanent browser test suite (12 tests, fake GitHub and DeepSeek, built-in server); all passing

### 2026-10-03 — Ownership Map: Table tab (plan phases 0–1)

- New `rk-tabs.js` / `rk-tabs.css` (add-on, no logic copied from `index.html`): Map | Table switch in the view bar, remembered per browser
- Table tab: Entities (type, groups, commodity, shareholders, board, recent stakes %, holdings, roles, latest data, sources) and Relationships (from, to, type, stake/role, status, dates, groups, sources)
- Follows the group, cluster, relationship and timeline filters; sort per column, text filter, CSV of the rows shown; row opens the detail panel, map-pin button jumps to the map
- Phone: table scrolls sideways with the name column pinned. Add-on API gained `linkPassesFilter`, `formatDate`, `dateSortKey`
- UI kept in English for consistency; "Data quality" tab comes with phase 2. 2 new tests; all 14 pass

### 2026-10-03 — Ownership Map: Data quality tab (plan phases 2–4)

- New `rk-quality.js`: tab "Data quality" with findings in 5 categories — incomplete company data (no shareholders, no board, stakes without %, no source, no date), possible duplicates (same or near-identical names, two current stakes/roles for one pair), group network (owners not recorded, no beneficial owner >25%, no group, people linking groups, group split into parts), possible data errors (stakes ≠100%, impossible %, board role that reads like a stake, company typed as individual, ownership loops), profile update needed (latest data older than a limit, default 12 months, set in the tab)
- Each finding: entity links (open the detail panel), Merge for duplicates, Read newer profile PDF for stale ones, Checked / Ignore / note. Marks are stored in the dataset (`reviews`) and saved to GitHub; a mark lapses when the data behind it changes
- Summary chips per category, "Show checked and ignored", worklist CSV of open findings; the sidebar Checks panel links to the tab
- Speed: label decluttering in `index.html` (`declutterEdgeLabels`) now uses a grid instead of comparing every pair — a 1,000-entity map froze ~25 s before, now ~0.1 s for that step
- Dataset texts updated for GitHub saving. 2 new tests (counts checked against the seed independently, marks, sync, threshold, CSV, merge, 1,000 entities, phone); all 16 pass
- Not done: reversed dates (the data model stores sorted dates, so they cannot occur)

### 2026-10-03 — Clearer GitHub connect errors

- Connect told every failure apart as "GitHub rejected that token". Now: not a token (e.g. the token's name pasted), api.github.com unreachable (firewall, VPN, blocker extension), GitHub error, or a really rejected token
- Spaces, line breaks and quotes around a pasted token are removed. 1 new test (17 total)

### 2026-10-03 — Ownership Map: focus from the right-click menu

- Entity right-click menu: *Focus on this entity*, *Focus on it and its direct relations*, *Focus on its whole network* (connected entities through any number of steps). Everything else is hidden through the existing hidden-entities mechanism; the map refits; *Show all* restores and refits
- Follows the Relationships and Timeline filters. `focusOn(id, depth)` sits next to `hideNode` in `index.html` and is on the add-on API, with `showAllNodes`
- 1 new test (18 total). In one full run the "quality: counts" test failed once and then passed 4 times on its own (likely timing under load)

### 2026-10-03 — Ownership Map: relation label setting

- Zoom toolbar button (and key `L`) cycles relation labels: full (stake or role + dates) → short (stake or role) → off. Entity names are not affected; zooming far out still hides all labels; remembered per browser (`om-relation-labels`); the PNG export copies the computed display, so it follows the setting
- In `index.html`: section "Relation labels" before the node context menu; the edge label text checks `labelMode`. Switching full ↔ short redraws the map (label sizes change)
- 1 new test; all 19 pass

### 2026-10-03 — Ownership Map: right-click menu on empty map space

- Right-click where there is no entity or relation: *Show all entities and relations* (clears hidden/focused entities, Relationships and Timeline back to All, refits; greyed out when nothing is narrowed), *Show all company groups and commodities too* (only when a group or commodity filter is on), *Fit the map to the view*
- Relations, panels and the Table / Data quality tabs keep the browser's own menu. In `index.html`: `#mapContextMenu`, `openMapMenu`, `showEverything`, shared `placeMenu`, next to the node context menu
- Tests: 1 new (20 total). The occasional "quality: counts" failure was the d3 CDN failing on a reload; `reload()` in `tests/run.js` now drops those errors when it retries

### 2026-10-03 — Ownership Map: eight UX changes

- **Hover highlight** (`rk-map.js`): pointing at an entity dims everything but it, its relations and neighbours
- **Timeline filter** (`index.html`, `drawGraph`): Recent/Previous now drop entities left without relations, like the Relationships filter (before: 149 of 165 floating dots in Previous)
- **Save status chip** (`rk-status.js`) in the top capsule; click connects / saves now
- **Multi-select** (`rk-map.js`): Shift/Ctrl+click, Shift+drag box; bar with Focus, Focus + relations, Hide, Assign group (adds the group to every relationship of the selected entities through `commitChanges`), Find connection for two
- **Connection finder** (`rk-connect.js`): shortest chains in the whole dataset, written step by step, indirect stake for pure ownership chains, Show only this / Light up on map
- **Detail panel** (`rk-detail.js`): Focus buttons, Open in table (`OwnershipMapTabs.openTable`), Find connection, Company report; Note moved to the top
- **As-of slider** (`rk-time.js`, hook in `graphFromMaster`): shows relationships in force in a month; each counts as current then, so chains and beneficial owners are as of that month. In force from the first date seen; superseded ones until the last date seen, others until now; undated ones optional. Data quality always leaves the past
- **Company report** (`rk-report.js`): shareholders, direct + indirect holders (checked against the detail panel's own calculation), beneficial owners, board, holdings, shared directors, points to check, sources; Print / Save as PDF with print CSS (tested: pdftotext, 2 pages)
- Add-on API grew: `focusOnSet`, `hideMany`, `setAsOf`/`getAsOf`, `fullGraph`, `refreshMap`, `hiddenIds`, `neighborsOf`, `selectedEntityId`. Event `om:asof`, `om:tab`
- Not done (not requested): the view bar still clips its last buttons at 1366–1536 px, and the Dataset panel still says nothing about a failed GitHub load
- 27 tests

### 2026-10-03 — Ownership Map: profile fields per entity

- Every entity can now carry `country` (jurisdiction), `address` and `identities` (list of kind + number: company registration no., NIB, NPWP, KTP/NIK, passport, other). Edited in a new "Profile" block in the detail panel (`rk-profile.js`, sits under Note); saved through `commitChanges`, so history, backup and GitHub saving carry it with no format change
- Shown as Country / Identity / Address columns in the Entities table (so also in its CSV), in the Entities CSV export (three new columns), in the company report (Profile section), found by map search (identity number, country) and kept by Merge (fills empty country/address, unions identities)
- Not done: bulk import of these fields from pasted rows or PDFs; Data quality checks for missing profile data
- 1 new test (28 total)

### 2026-10-03 — Ownership Map: foldable sidebar panels

- New `rk-fold.js`: every sidebar panel (Company groups, Commodity, Search, Data, Dataset, Export) folds down to its heading when the heading is clicked (or Enter / Space); chevron shows the state, `aria-expanded` is set, state is remembered per browser. Panels the app hides stay hidden. The save-status chip unfolds Dataset before it scrolls there
- 1 new test (29 total)

### 2026-10-03 — Ownership Map: Statistics tab

- New `rk-stats.js`: tab "Statistics" (fourth tab) with aggregate figures for analysis, computed from what the map shows (group, relationship, timeline and as-of filters apply, as in Table). Cards: overview (companies, individuals, shareholdings, board roles, current / previous, beneficial owners, owners not recorded), data coverage (% of companies with shareholders / stakes adding to 100% / board; % of relationships with source and date; % of entities with country, address, identity), ownership concentration (largest direct holder buckets), who controls most (>50% effective), largest beneficial owners, most holdings, boards (average size, people on 2+ boards, most seats, largest boards, roles), most connected, company groups table, countries, relationships by year first seen
- Bars are plain CSS (no chart library); names open the detail panel; "Statistics CSV" saves every figure as section, label, value. The as-of bar hides on this tab like on Table
- 1 new test (checks the figures against the graph itself, the Kaltim group size, the Timeline filter, CSV); 30 total

---

## Notes

- The master dataset `indonesia_wood_pulp_v3_1_0.csv` and `Documentation.csv` are the largest files (~17 MB each)
- Trase export files cover 2015-2025 with consistent schema across years
- `iwp3` files track supply chain details including deforestation, emissions, concession areas
- Active data collection ongoing — `02i2025*.csv` files are updated regularly
