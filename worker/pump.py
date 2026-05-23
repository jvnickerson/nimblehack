#!/usr/bin/env python3
"""
Nimble + Reddit + RSS → ClickHouse pump.

Two polling tiers:
  FAST (every FAST_INTERVAL_SEC, default 30s)  — Reddit JSON feeds, free + real-time
  SLOW (every SLOW_INTERVAL_SEC, default 300s) — Nimble agents (Yahoo, Bloomberg, SEC)

Dedupes via SHA-256(lower(headline)) per ticker. Sets first_seen_at = now()
on insert so the UI can flag genuinely fresh signals.

Env vars:
  NIMBLE_API_KEY            required, for `nimble` CLI
  CH_HOST, CH_USER, CH_PWD  required, ClickHouse Cloud
  FAST_INTERVAL_SEC=30      optional
  SLOW_INTERVAL_SEC=300     optional
  REDDIT_SUBS=...           optional comma list, default: wallstreetbets,stocks,investing,options
"""
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import clickhouse_connect

ROOT = Path(__file__).resolve().parent.parent
TICKERS_FILE = ROOT / "tickers.json"
FAST_INTERVAL = int(os.environ.get("FAST_INTERVAL_SEC", "30"))
SLOW_INTERVAL = int(os.environ.get("SLOW_INTERVAL_SEC", "300"))
CLIENT_SOURCE = "skill-nimblehack-pump"
REDDIT_SUBS = [s.strip() for s in os.environ.get(
    "REDDIT_SUBS", "wallstreetbets,stocks,investing,options"
).split(",") if s.strip()]
REDDIT_UA = "nimblehack-demo/0.2 (datadog-hackathon)"

DEFAULT_CIK = {
    "AAPL": "0000320193", "MSFT": "0000789019", "NVDA": "0001045810",
    "DDOG": "0001561550", "GOOGL": "0001652044", "META": "0001326801",
    "AMZN": "0001018724", "TSLA": "0001318605",
}
CIK_MAP = {**DEFAULT_CIK, **json.loads(os.environ.get("CIK_MAP", "{}"))}


# ---------- helpers ----------

def hash_id(headline):
    return hashlib.sha256(headline.strip().lower().encode("utf-8")).hexdigest()[:16]


def now_utc():
    return datetime.now(timezone.utc)


def parse_published(p):
    if not p:
        return None
    try:
        if isinstance(p, (int, float)):
            return datetime.fromtimestamp(p, tz=timezone.utc)
        if isinstance(p, str) and len(p) == 10:
            return datetime.strptime(p, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(str(p).replace("Z", "+00:00"))
    except Exception:
        return None


# ---------- FAST tier: Reddit ----------

def reddit_subreddit_new(subreddit, limit=50):
    """Return latest N posts from a subreddit. No auth required."""
    url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": REDDIT_UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.load(r)
    return [c["data"] for c in data.get("data", {}).get("children", [])]


def attribute_tickers(post, tickers):
    """Return list of tickers explicitly mentioned in title or body."""
    text = (post.get("title", "") + "  " + (post.get("selftext") or ""))
    hits = []
    for t in tickers:
        if re.search(rf"\$?\b{re.escape(t)}\b", text, re.IGNORECASE):
            hits.append(t)
    return hits


def fetch_reddit_signals(tickers):
    """Pull from all configured subs, attribute to tickers, return rows."""
    rows_by_ticker = {t: [] for t in tickers}
    for sub in REDDIT_SUBS:
        try:
            posts = reddit_subreddit_new(sub)
        except Exception as e:
            print(f"[err] reddit/{sub}: {e}")
            continue
        for p in posts:
            for t in attribute_tickers(p, tickers):
                rows_by_ticker[t].append({
                    "source": "reddit",
                    "source_id": p.get("permalink") or p.get("id") or "",
                    "headline": (p.get("title") or "").strip(),
                    "summary": (p.get("selftext") or "")[:600],
                    "url": "https://reddit.com" + (p.get("permalink") or ""),
                    "event_type": "social",
                    "published_at": p.get("created_utc"),
                })
        print(f"[reddit] r/{sub}: {len(posts)} posts scanned")
    return rows_by_ticker


# ---------- SLOW tier: Nimble agents ----------

def nimble(*args):
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


SLOW_SOURCES = [
    ("yahoo_news", lambda t: yahoo_news(t)),
    ("bloomberg",  lambda t: bloomberg_search(t)),
    ("sec_8K",     lambda t: sec_filings(t, "8-K")),
]


# ---------- ingestion ----------

CH_COLUMNS = [
    "ticker", "source", "source_id", "headline", "summary", "url",
    "event_type", "sentiment", "embedding",
    "published_at", "fetched_at", "first_seen_at", "hash_id",
]


def load_seen(ch, tickers):
    seen = {t: set() for t in tickers}
    try:
        result = ch.query("SELECT ticker, hash_id FROM signals")
        for ticker, h in result.result_rows:
            seen.setdefault(ticker, set()).add(h)
    except Exception as e:
        print(f"[warn] load_seen (likely empty table): {e}")
    return seen


def build_batch(rows_by_ticker, seen, fetched):
    """Filter to new rows, expand to CH tuples."""
    batch = []
    for ticker, rows in rows_by_ticker.items():
        new_count = 0
        for r in rows:
            headline = (r["headline"] or "").strip()
            if not headline:
                continue
            h = hash_id(headline)
            if h in seen.get(ticker, set()):
                continue
            seen.setdefault(ticker, set()).add(h)
            new_count += 1
            batch.append((
                ticker, r["source"], r["source_id"],
                headline, r["summary"] or "", r["url"] or "",
                r["event_type"], 0.0, [],
                parse_published(r["published_at"]) or fetched,
                fetched, fetched, h,
            ))
        if new_count:
            print(f"[new] {ticker}: +{new_count}")
    return batch


def insert(ch, batch):
    if not batch:
        return 0
    ch.insert("signals", batch, column_names=CH_COLUMNS)
    return len(batch)


def poll_fast(ch, tickers, seen):
    fetched = now_utc()
    rows_by_ticker = fetch_reddit_signals(tickers)
    n = insert(ch, build_batch(rows_by_ticker, seen, fetched))
    print(f"[fast] inserted {n} reddit signals")
    return n


def poll_slow(ch, tickers, seen):
    fetched = now_utc()
    rows_by_ticker = {t: [] for t in tickers}
    for ticker in tickers:
        for source_name, fn in SLOW_SOURCES:
            try:
                rows = fn(ticker)
                rows_by_ticker[ticker].extend(rows)
                print(f"[slow] {ticker}/{source_name}: {len(rows)}")
            except Exception as e:
                print(f"[err] {ticker}/{source_name}: {e}")
    n = insert(ch, build_batch(rows_by_ticker, seen, fetched))
    print(f"[slow] inserted {n} nimble signals")
    return n


# ---------- main loop ----------

def main():
    tickers = json.loads(TICKERS_FILE.read_text())["tickers"]
    slow_every = max(1, SLOW_INTERVAL // FAST_INTERVAL)
    print(f"[boot] tickers={tickers}")
    print(f"[boot] fast={FAST_INTERVAL}s (reddit), slow={SLOW_INTERVAL}s (nimble, every {slow_every} fast ticks)")
    print(f"[boot] reddit subs={REDDIT_SUBS}")

    ch = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"],
        user=os.environ.get("CH_USER", "default"),
        password=os.environ["CH_PWD"],
        secure=True,
    )
    seen = load_seen(ch, tickers)
    print(f"[boot] dedup seeded: { {t: len(s) for t, s in seen.items()} }")

    iteration = 0
    while True:
        try:
            poll_fast(ch, tickers, seen)
            if iteration % slow_every == 0:
                poll_slow(ch, tickers, seen)
        except Exception as e:
            print(f"[err] loop: {e}")
        iteration += 1
        time.sleep(FAST_INTERVAL)


if __name__ == "__main__":
    main()
