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

---

## Notes

- The master dataset `indonesia_wood_pulp_v3_1_0.csv` and `Documentation.csv` are the largest files (~17 MB each)
- Trase export files cover 2015-2025 with consistent schema across years
- `iwp3` files track supply chain details including deforestation, emissions, concession areas
- Active data collection ongoing — `02i2025*.csv` files are updated regularly
