-- ClickHouse Cloud schema for nimblehack
-- Run once: clickhouse-client --host=$CH_HOST --user=default --password=$CH_PWD --secure < schema.sql

CREATE TABLE IF NOT EXISTS signals (
  ticker          LowCardinality(String),
  source          LowCardinality(String),       -- 'yahoo_news','bloomberg','sec_8K','sec_10K','sec_10Q','reddit'
  source_id       String,                       -- url or accession_number (informational)
  headline        String,
  summary         String,
  url             String,
  event_type      LowCardinality(String),       -- 'news','filing','social'
  sentiment       Float32 DEFAULT 0,            -- -1..1, populated later
  embedding       Array(Float32) DEFAULT [],    -- vector, Brendan's lane
  published_at    DateTime64(3) DEFAULT now64(3),
  fetched_at      DateTime64(3) DEFAULT now64(3),
  first_seen_at   DateTime64(3) DEFAULT now64(3),
  hash_id         String                        -- sha256(lower(headline))[:16], dedup key per ticker
)
ENGINE = MergeTree
ORDER BY (ticker, source, hash_id, fetched_at)
PARTITION BY toYYYYMM(fetched_at);

-- Speed up "what's new in the last N min" queries
ALTER TABLE signals ADD INDEX IF NOT EXISTS idx_first_seen first_seen_at TYPE minmax GRANULARITY 4;

-- Full-text-ish search on headlines
ALTER TABLE signals ADD INDEX IF NOT EXISTS idx_headline headline TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4;
