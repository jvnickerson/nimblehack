import { recentSignals, tickerSummary, indexStats, type Signal, type TickerSummary, type IndexStats } from "@/lib/ch";
import { AutoRefresh } from "./auto-refresh";
import { UnlockButton } from "./unlock-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FRESH_MINUTES = 5;

function fmtTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString();
}

function isFresh(iso: string, minutes = FRESH_MINUTES): boolean {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return (Date.now() - d.getTime()) < minutes * 60 * 1000;
}

export default async function Home() {
  let summary: TickerSummary[] = [];
  let signals: Signal[] = [];
  let stats: IndexStats | null = null;
  let error: string | null = null;
  try {
    [summary, signals, stats] = await Promise.all([
      tickerSummary(),
      recentSignals({ limit: 80 }),
      indexStats(),
    ]);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  // Ticker tape: top 18 most recent, duplicated for seamless loop
  const tape = signals.slice(0, 18);

  return (
    <>
      <AutoRefresh intervalMs={10000} />

      {tape.length > 0 && (
        <div className="ticker-tape">
          <div className="ticker-tape-track">
            {[...tape, ...tape].map((s, i) => (
              <span className="ticker-tape-item" key={i}>
                <span className="tt-ticker">{s.ticker}</span>
                <span className="tt-source">{s.source}</span>
                <span className="tt-headline">{s.headline}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <main>
        <div className="header-row">
          <h1><span className="pulse" />Weekend Signal Agent</h1>
          <span className="subtle">Open-web monitoring · auto-refresh 10s · poll 30s</span>
        </div>

        {stats && (
          <div className="stat-bar">
            <div className="stat-bar-item">
              <div className="v">{stats.total.toLocaleString()}</div>
              <div className="l">total signals</div>
            </div>
            <div className="stat-bar-item">
              <div className={`v ${Number(stats.signals_5min) > 0 ? "hot" : ""}`}>{stats.signals_5min}</div>
              <div className="l">last 5 min</div>
            </div>
            <div className="stat-bar-item">
              <div className="v">{stats.sources}</div>
              <div className="l">sources</div>
            </div>
            <div className="stat-bar-item">
              <div className="v">{stats.embedded.toLocaleString()} <span className="subtle">/ {stats.total.toLocaleString()}</span></div>
              <div className="l">vector indexed ({stats.pct}%)</div>
              <div className="progress"><div className="progress-fill" style={{ width: `${stats.pct}%` }} /></div>
            </div>
          </div>
        )}

        {error && (
          <div className="empty">
            <strong>Can&apos;t reach ClickHouse.</strong>
            <div style={{ marginTop: 8, fontSize: 12 }}>{error}</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Set <code>CH_HOST</code>, <code>CH_USER</code>, <code>CH_PWD</code> and run <code>schema.sql</code>.
            </div>
          </div>
        )}

        {!error && summary.length === 0 && (
          <div className="empty">
            No signals yet. Start the worker: <code>cd worker &amp;&amp; python pump.py</code>
          </div>
        )}

        {summary.length > 0 && (
          <>
            <h2>Watchlist</h2>
            <div className="grid">
              {summary.map((t) => (
                <div key={t.ticker} className="card">
                  <div className="ticker">{t.ticker}</div>
                  <div className="stat-row">
                    <div className="stat">
                      <div className={`v ${Number(t.fresh_1h) > 0 ? "hot" : ""}`}>{t.fresh_1h}</div>
                      <div className="l">5 min</div>
                    </div>
                    <div className="stat">
                      <div className="v">{t.fresh_24h}</div>
                      <div className="l">24h</div>
                    </div>
                    <div className="stat">
                      <div className="v">{t.sources}</div>
                      <div className="l">sources</div>
                    </div>
                  </div>
                  <div className="subtle" style={{ marginTop: 8, fontSize: 11 }}>
                    latest: {t.latest ? fmtTime(t.latest) : "—"}
                  </div>
                  <UnlockButton ticker={t.ticker} />
                </div>
              ))}
            </div>

            <h2>Live signal feed</h2>
            <div className="feed">
              {signals.map((s, i) => {
                const fresh = isFresh(s.first_seen_at);
                return (
                  <div key={i} className={`feed-item ${fresh ? "fresh" : ""}`}>
                    <div className="top">
                      <span className="ticker">{s.ticker}</span>
                      <span className="source">{s.source}</span>
                      {fresh && <span className="badge new">NEW</span>}
                      <span className="time">{fmtTime(s.first_seen_at)}</span>
                    </div>
                    <div className="headline">
                      {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.headline}</a> : s.headline}
                    </div>
                    {s.summary && <div className="summary">{s.summary.slice(0, 280)}{s.summary.length > 280 ? "…" : ""}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}
