# PostgreSQL persistence

The backend stores analysis history, the singleton portfolio, pipeline decisions, outreach runs and company/contact cards in PostgreSQL. IQVIA, MOHAP and UPP are reference CSVs loaded at startup; this migration does not move them. Forecast session state remains in the browser.

Set `DATABASE_URL` on the backend to a standard PostgreSQL connection URL, for example `postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`. Keep it server side; never set a `NEXT_PUBLIC_` variable for it. The database user needs permission to create the `dirac` schema and tables for the first startup. Startup applies versioned SQL files in `migrations/` transactionally. The app uses the private `dirac` schema, outside the default Supabase Data API exposed `public` schema. No Supabase SDK or project is required.

Install `requirements.txt` before starting the backend. Startup fails clearly when `DATABASE_URL` is absent or invalid. For an existing deployment, back up its persistent `data/contacts.db`, then stop backend writes and run:

```bash
cd 'deploy app/backend'
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require'
python scripts/migrate_sqlite_to_postgres.py /path/to/contacts.db
```

If the old `data/analyses.json` archive contains runs absent from SQLite, append `--analyses-json /path/to/analyses.json`. The importer copies all five SQLite tables and optionally those archived runs in one transaction. Existing identical rows are skipped, so it can run against COMIX OS after the archived Tecnimed analysis was imported. Any conflicting primary key aborts the whole import without overwriting data. It advances the outreach company identity sequence. Keep the original SQLite file as backup until the API lists and retrieves the expected data.

For a self-managed PostgreSQL server, back up and restore with `pg_dump` and `pg_restore`. If using Supabase later, obtain the Postgres connection string from that project and set it as `DATABASE_URL`; the backend does not use Supabase client credentials.

## Inventory

The inventory page lists every distinct IQVIA manufacturer/product/strength/pack combination whose molecule is in My Portfolio. Pack details come from the startup-loaded IQVIA CSV. Duplicate market rows for the same pack appear once. The CSV has no product-code field, so the UI shows it as unavailable. The app derives a stable internal pack key from molecule, manufacturer, product, strength and pack size; `dirac.inventory_stock` stores the current quantity in packs. Unsaved quantities show as zero. A CSV refresh that changes those identity fields creates a new key, so review stock after refreshing IQVIA. Portfolio molecules with no IQVIA match are reported above the table.

## COMIX OS Supabase project

The `COMIX OS` Supabase project (`xgaomspclfexhkdfgwgv`) has the `dirac` schema and migrations `001_initial` and `002_inventory` applied. The legacy `Tecnimed` analysis from `data/analyses.json` was imported and verified. The original local `contacts.db` contained no rows. The backend still needs a server-side `DATABASE_URL` from this project's database connection settings; the Supabase connector does not provide the database password. Never put this URL in a frontend environment variable.
