# CLAUDE.md

Central log for all work done with Claude Code on this repository.

## Project Overview

**rumahkerumah** is a research data repository tracking Indonesian wood and pulp supply chains, deforestation, environmental impacts, and corporate accountability.

### Key Data Categories

| Category | Files | Description |
|----------|-------|-------------|
| Trase Exports | `Trase-Export-*.csv`, `Trase2025.csv` | Indonesian pulp export volumes, FOB values, mills, importers (2015-2025) |
| Wood & Pulp Supply Chain | `iwp3_*.csv`, `indonesia_wood_pulp_v3_1_0.csv` | Detailed sourcing, deforestation metrics, emissions (2015-2022) |
| Deforestation Intel | `02i2025n.csv`, `02i2025r.csv` | 2025 deforestation incidents and case reports |
| Corporate Intelligence | `cSPKaltim.csv` | Shareholding, directorships, company linkages in Kalimantan |
| Documentation | `Documentation.csv` | Field-level metadata for the datasets |

### Repository Structure

```
rumahkerumah/
├── CLAUDE.md                          # This file - central log
├── Documentation.csv                  # Dataset metadata
├── 02i2025n.csv                       # Deforestation news/incidents 2025
├── 02i2025r.csv                       # Deforestation research data 2025
├── cSPKaltim.csv                      # Corporate/concession data (Kaltim)
├── Trase-Export-2015 - Sheet1.csv     # Pulp export data (2015)
├── Trase-Export-2016 - 2016.csv       # Pulp export data (2016)
├── Trase-Export - 2017.csv            # Pulp export data (2017)
├── ...                                # Trase exports through 2024
├── Trase2025.csv                      # Pulp export data (2025)
├── iwp3_2015.csv                      # Wood & pulp supply chain (2015)
├── iwp3_2015err.csv                   # Error records for 2015
├── iwp3_2016.csv ~ iwp3_2022.csv      # Wood & pulp supply chain (2016-2022)
└── indonesia_wood_pulp_v3_1_0.csv     # Master dataset (v3.1.0)
```

## Session Log

### 2026-02-04 — Initial setup

- Explored the full repository structure and all 25 CSV data files
- Created this `CLAUDE.md` as the central index for Claude Code work
- No existing documentation (README, LICENSE, .gitignore) was present prior to this

---

## Notes

- All data files are CSVs in the repository root (flat structure, no subdirectories)
- The master dataset `indonesia_wood_pulp_v3_1_0.csv` and `Documentation.csv` are the largest files (~17 MB each)
- Trase export files cover 2015-2025 with consistent schema across years
- `iwp3` files track supply chain details including deforestation, emissions, concession areas
- Active data collection ongoing — `02i2025*.csv` files are updated regularly
