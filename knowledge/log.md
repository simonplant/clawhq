# Log

## [2026-04-16] lint | Merge dp-conviction-scoring into dp-extraction-rules

Merged dp-conviction-scoring.md into dp-extraction-rules.md — conviction scoring is a sub-topic of extraction, not an independent page. Updated all cross-references (dp-methodology, trading-system, account-system, standard-order-format, index).

## [2026-04-16] ingest | trading-system.md — Clawdius's own trading system

Created trading-system.md: defines the system's edge (synthesis, discipline, weighted conviction, timing intelligence), four evolution phases (mirror → weighted → autonomous Tradier → own ideas), feedback loops (daily EOD → weekly pattern review → monthly structural changes), action thresholds for cutting/upsizing setups, and success/failure criteria.

## [2026-04-16] lint | Wiki cleanup

Cleaned up wiki pages:
- Removed "v4.0-QR" branding from mancini-extraction-rules (was just a filename, not a real version)
- Renamed pot-system -> account-system. Removed stale 3-pot experiment framing ($33K each). Now reflects actual account structure (tos $100K, ira $100K, tradier $3K) with all accounts eligible for all trade types.
- Fixed `pot` -> `accounts` field references throughout (standard-order-format, dp-extraction-rules)
- Updated Mancini exec_as to /MES (was still referencing SPY conversion in places)
- Reorganized index: Methodologies / Extraction / System (was Markets / Risks / Comparisons)
- Updated all cross-references from [[pot-system]] to [[account-system]]
- Updated all page dates to 2026-04-16

## [2026-04-15] ingest | Initial methodology sources

Ingested 5 raw sources from configs/references/ to bootstrap the trading wiki:
- raw/dp.md, raw/mancini.md, raw/extract-mancini.md, raw/analyze-dp.md, raw/analyze-mancini.md

Pages created: mancini-methodology, mancini-extraction-rules, dp-methodology, dp-conviction-scoring, dp-extraction-rules, pot-system, standard-order-format.

## [2026-04-16] init | Wiki created

Initialized LLM Wiki instance.
