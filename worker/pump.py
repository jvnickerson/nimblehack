#!/usr/bin/env python3
"""
Nimble → ClickHouse pump.

Polls Nimble agents per ticker on a schedule, deduplicates via
SHA-256(lower(headline)) per ticker, and inserts new rows into the
`signals` table on ClickHouse Cloud.

Env vars:
  NIMBLE_API_KEY            required, used by `nimble` CLI
  CH_HOST, CH_USER, CH_PWD  required, ClickHouse Cloud
  POLL_INTERVAL_SEC=120     optional
  CIK_MAP                   optional JSON object to extend the SEC CIK map
"""
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import clickhouse_connect

ROOT = Path(__file__).resolve().parent.parent
TICKERS_FILE = ROOT / "tickers.json"
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SEC", "120"))
CLIENT_SOURCE = "skill-nimblehack-pump"

DEFAULT_CIK = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "NVDA": "0001045810",
    "DDOG": "0001561550",
    "GOOGL": "0001652044",
    "META": "0001326801",
    "AMZN": "0001018724",
    "TSLA": "0001318605",
}
CIK_MAP = {**DEFAULT_CIK, **json.loads(os.environ.get("CIK_MAP", "{}"))}


def nimble(*args: str) -> object:
    cmd = ["nimble", "--client-source", CLIENT_SOURCE, *args]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise RuntimeError(f"nimble failed: {out.stderr[:400]}")
    return json.loads(out.stdout)


def yahoo_news(ticker):
    data = nimble(
        "--transform", "data.parsing",
        "agent", "run",
        "--agent", "finance_yahoo_com_financial_news_community_2026_03_24_2026_03_23_0ojd1wyn",
        "--params", json.dumps({"ticker": ticker}),
    )
    rows = []
    for i, item in enumerate(data or []):
        title = (item.get("name") or "").strip()
        if not title:
            continue
        rows.append({
            "source": "yahoo_news",
            "source_id": f"yahoo/{ticker}/{i}",
            "headline": title,
            "summary": item.get("description") or "",
            "url": "",
            "event_type": "news",
            "published_at": None,
        })
    return rows


def bloomberg_search(ticker):
    data = nimble(
        "--transform", "data.parsing",
        "agent", "run",
        "--agent", "bloomberg_search_2026_02_23_a9u4p1tv",
        "--params", json.dumps({"query": ticker}),
    )
    rows = []
    for item in data or []:
        title = (item.get("headline") or "").strip()
        if not title:
            continue
        rows.append({
            "source": "bloomberg",
            "source_id": item.get("image_url") or title,
            "headline": title,
            "summary": item.get("summary") or "",
            "url": "",
            "event_type": "news",
            "published_at": item.get("date"),
        })
    return rows


def sec_filings(ticker, form_type):
    cik = CIK_MAP.get(ticker)
    if not cik:
        return []
    data = nimble(
        "--transform", "data.parsing",
        "agent", "run",
        "--agent", "sec_gov_company_filing_details_community_2026_05_08",
        "--params", json.dumps({"cik_number": cik, "form_type": form_type}),
    )
    rows = []
    for f in (data or {}).get("filings", []):
        acc = f.get("accession_number") or ""
        if not acc:
            continue
        rows.append({
            "source": f"sec_{form_type.replace('-', '')}",
            "source_id": acc,
            "headline": f"{form_type} filed {f.get('filing_date','')}: {f.get('description','')}",
            "summary": f.get("description") or "",
            "url": f"https://www.sec.gov{f.get('document_url','')}",
            "event_type": "filing",
            "published_at": f.get("filing_date"),
        })
    return rows


SOURCES = [
    ("yahoo_news", lambda t: yahoo_news(t)),
    ("bloomberg",  lambda t: bloomberg_search(t)),
    ("sec_8K",     lambda t: sec_filings(t, "8-K")),
]


def hash_id(headline):
    return hashlib.sha256(headline.strip().lower().encode("utf-8")).hexdigest()[:16]


def now_utc():
    return datetime.now(timezone.utc)


def parse_published(p):
    if not p:
        return None
    try:
        if isinstance(p, str) and len(p) == 10:
            return datetime.strptime(p, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(str(p).replace("Z", "+00:00"))
    except Exception:
        return None


def load_seen(ch, tickers):
    seen = {t: set() for t in tickers}
    try:
        result = ch.query("SELECT ticker, hash_id FROM signals")
        for ticker, h in result.result_rows:
            seen.setdefault(ticker, set()).add(h)
    except Exception as e:
        print(f"[warn] load_seen (likely empty table): {e}")
    return seen


def poll_once(ch, tickers, seen):
    fetched = now_utc()
    batch = []
    for ticker in tickers:
        for source_name, fn in SOURCES:
            try:
                rows = fn(ticker)
            except Exception as e:
                print(f"[err] {ticker}/{source_name}: {e}")
                continue
            new_count = 0
            for r in rows:
                h = hash_id(r["headline"])
                if h in seen[ticker]:
                    continue
                seen[ticker].add(h)
                new_count += 1
                batch.append((
                    ticker, r["source"], r["source_id"],
                    r["headline"], r["summary"], r["url"],
                    r["event_type"], 0.0, [],
                    parse_published(r["published_at"]) or fetched,
                    fetched, fetched, h,
                ))
            print(f"[fetch] {ticker}/{source_name}: {len(rows)} total, {new_count} new")
    if not batch:
        print("[poll] no new signals this round")
        return 0
    ch.insert("signals", batch, column_names=[
        "ticker","source","source_id","headline","summary","url",
        "event_type","sentiment","embedding",
        "published_at","fetched_at","first_seen_at","hash_id",
    ])
    print(f"[poll] inserted {len(batch)} new signals")
    return len(batch)


def main():
    tickers = json.loads(TICKERS_FILE.read_text())["tickers"]
    print(f"[boot] tickers={tickers} interval={POLL_INTERVAL}s")
    ch = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"],
        user=os.environ.get("CH_USER", "default"),
        password=os.environ["CH_PWD"],
        secure=True,
    )
    seen = load_seen(ch, tickers)
    print(f"[boot] dedup seeded: {{t: len for t,len in [(t,len(s)) for t,s in seen.items()]}}")
    while True:
        try:
            poll_once(ch, tickers, seen)
        except Exception as e:
            print(f"[err] poll loop: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
