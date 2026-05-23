# nimblehack

Autonomous weekend signal agent: monitors the open web (Nimble agents → Yahoo Finance news, Bloomberg search, SEC EDGAR filings), accumulates signals into ClickHouse Cloud with vector embeddings, and surfaces a real-time watchlist for the Monday open. Built for the Datadog hackathon, 2026-05-23.

## Architecture

```
[Nimble agents]──┐                     ┌──> Brendan: embeddings + vector queries
                 ↓                     │
        worker/pump.py  ──insert──>  ClickHouse Cloud (signals table)
                                       │
                                       └──> web/ (Next.js Server Components on Vercel)
```

## Quick start

### 0. Prereqs

- `nimble` CLI installed (`npm i -g @nimble-way/nimble-cli`) and `NIMBLE_API_KEY` exported.
- ClickHouse Cloud cluster (Brendan).
- Node 20+ for `web/`, Python 3.10+ for `worker/`.

### 1. Provision the schema

```bash
clickhouse client --host=$CH_HOST --user=default --password=$CH_PWD --secure < schema.sql
```

### 2. Run the worker

```bash
cd worker
pip install -r requirements.txt
cp ../.env.example ../.env  # fill in CH_HOST / CH_PWD / NIMBLE_API_KEY
set -a; source ../.env; set +a
python pump.py
```

You'll see polling output every `POLL_INTERVAL_SEC` (default 120s). Each new headline gets a stable `hash_id` (sha256 of normalized headline) so re-polls don't create dupes.

### 3. Run the dashboard

```bash
cd web
npm install
# .env.local with CH_HOST, CH_USER, CH_PWD
npm run dev
# open http://localhost:3000
```

### 4. Deploy

- **Frontend → Vercel**: `cd web && vercel --prod`. Set `CH_HOST`, `CH_USER`, `CH_PWD` in the Vercel project env.
- **Worker → Railway/Fly**: point at `worker/`, set the same env vars, set start command to `python pump.py`.

## Schema

See [`schema.sql`](./schema.sql). Key columns:

| Column | Purpose |
|---|---|
| `ticker`, `source`, `hash_id` | dedup key — `sha256(lower(headline))[:16]` per ticker+source |
| `first_seen_at` | when *we* first observed the signal — drives NEW badges |
| `fetched_at` | most recent poll that saw it |
| `embedding Array(Float32)` | vector for semantic novelty / clustering / kNN — Brendan's lane |
| `sentiment Float32` | placeholder, filled by a later pass |

## Sources

The worker currently polls three Nimble pre-built agents per ticker:

| Source | Agent name | Returns |
|---|---|---|
| Yahoo News | `finance_yahoo_com_financial_news_community_…` | headlines + descriptions for a ticker |
| Bloomberg | `bloomberg_search_…` | search results (headline, summary, date) |
| SEC EDGAR 8-K | `sec_gov_company_filing_details_community_…` | recent 8-K filings for a CIK |

Adding Reddit: drop in `nimble search --include-domain '["reddit.com"]' --query <ticker>` and append to `SOURCES` in `pump.py`.

## Story (for judges)

> Markets close Friday 4pm. Anything moves over the weekend? You won't know until Monday — unless an agent is watching Reddit, SEC filings, and niche blogs the whole time. Bloomberg shuts off too. This one doesn't.
>
> Signal velocity, cross-source corroboration via vector clustering, and a NEW-vs-STALE feed Bloomberg can't show. Premium endpoints are gated by x402 + CDP wallet payments — the agent monetizes itself.

## Sponsor tools used

- **Nimble** — agents + search for grounded open-web data
- **ClickHouse Cloud** — time-series store + vector index
- **Datadog** — agent observability dashboards (planned)
- **CDP / x402** — agent payment rails (planned)
