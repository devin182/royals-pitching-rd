# Royals pitching R&D portfolio -- reproducible pipeline
# Requires: python3 (duckdb), R >= 4.3 with DBI, duckdb, data.table, xgboost, jsonlite, rmarkdown, ggplot2 (+ pandoc), google-chrome
RSCRIPT ?= $(shell command -v Rscript || echo /home/box/renv/bin/Rscript)
SEASON  ?= 2026
# pitcher id for the sample PDF card (Michael Wacha)
FEATURED ?= 608379

.PHONY: all fetch db model analysis lab sequencing teams tunnel report pdf pages serve clean
all: fetch db model analysis lab sequencing teams tunnel report pdf pages

fetch:      ## download pitch-level CSVs (one per day) + player names
	SEASON=$(SEASON) python3 scripts/fetch_statcast.py
	python3 scripts/fetch_players.py

db:         ## run sql/*.sql in DuckDB (from R)
	$(RSCRIPT) R/01_build_db.R

model:      ## Stuff+ (xgboost) with temporal-holdout validation
	$(RSCRIPT) R/02_stuff_model.R

analysis:   ## research analyses -> site/data/*.json
	$(RSCRIPT) R/03_analysis.R

lab:        ## export Stuff+ trees + per-team pitch samples for the in-browser Pitch Design Lab
	$(RSCRIPT) R/05_design_lab.R
	node tests/js/lab.test.js

sequencing: ## previous-pitch sequencing model vs no-sequence baseline -> site/data/sequencing.json
	$(RSCRIPT) R/06_sequencing.R

teams:      ## all 30 clubs: team summary, per-team pitcher files, month-by-month season tracker -> site/data/t/
	$(RSCRIPT) R/07_teams.R

tunnel:     ## Tunnel Viewer data for every team (reuses tunnel/build_tunnel.py) -> site/tunnel/teams/
	python3 scripts/build_tunnel_teams.py

report:     ## daily report + pitcher cards (R Markdown with SQL chunks)
	$(RSCRIPT) R/04_reports.R

pdf:        ## print reports to PDF (headless Chrome)
	FEATURED=$(FEATURED) scripts/print_pdf.sh

pages:      ## assemble static pages + copy code into the site
	python3 scripts/build_pages.py

daily: fetch db report pdf   ## the in-season morning job

serve:
	python3 -m http.server -d site 8000

clean:
	rm -f data/statcast.duckdb data/out/* site/data/*.json site/reports/*.html site/reports/*.pdf site/reports/cards/*.html
	rm -rf site/data/t site/data/seq site/data/lab/teams site/data/lab/p site/tunnel/teams
