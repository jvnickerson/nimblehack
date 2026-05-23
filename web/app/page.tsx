import {
  recentSignals,
  tickerSummary,
  indexStats,
  sentimentByTicker,
  recentRedditSignals,
  type Signal,
  type TickerSummary,
  type IndexStats,
  type SentimentRow,
} from "@/lib/ch";
import { crossTickerThemes } from "@/lib/themes";
import { AutoRefresh } from "./auto-refresh";
import { UnlockButton } from "./unlock-button";
import { NarrativeGraph } from "./narrative-graph";

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

function fmtTimeSeconds(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 90) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${Math.floor(diff % 60)}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function isFresh(iso: string, minutes = FRESH_MINUTES): boolean {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return Date.now() - d.getTime() < minutes * 60 * 1000;
}

function sentimentBorder(score: number): string {
  if (score === 0) return "var(--border)";
  const t = Math.min(1, Math.abs(score));
  return score > 0
    ? `rgba(124, 227, 139, ${0.35 + t * 0.55})`
    : `rgba(248, 113, 113, ${0.35 + t * 0.55})`;
}

function sentimentLabel(s: SentimentRow | undefined): string {
  if (!s || s.pos + s.neg === 0) return "—";
  const pct = Math.round(s.score * 100);
  if (pct > 0) return `+${pct}`;
  return String(pct);
}

export default async function Home() {
  let summary: TickerSummary[] = [];
  let signals: Signal[] = [];
  let stats: IndexStats | null = null;
  let graphSignals: Signal[] = [];
  let sentiments: Record<string, SentimentRow> = {};
  let redditSignals: Signal[] = [];
  let error: string | null = null;
  try {
    [summary, signals, stats, graphSignals, sentiments, redditSignals] = await Promise.all([
      tickerSummary(),
      recentSignals({ limit: 60 }),
      indexStats(),
      recentSignals({ sinceMinutes: 360, limit: 250 }),
      sentimentByTicker(),
      recentRedditSignals(30),
    ]);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const themes = crossTickerThemes(graphSignals, 4);
  const tape = signals.slice(0, 18);

  return (
    <>
      <AutoRefresh intervalMs={5000} />

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
          <span className="subtle">Open-web monitoring · auto-refresh 5s · poll 15s</span>
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
          </div>
        )}

        {!error && summary.length === 0 && (
          <div className="empty">
            No signals yet. Start the worker: <code>cd worker &amp;&amp; python pump.py</code>
          </div>
        )}

        {graphSignals.length > 0 && <NarrativeGraph signals={graphSignals} />}

        {themes.length > 0 ? (
          <div className="narratives-callout">
            <div className="narratives-label">🌀 Diverging narratives — stories spanning multiple tickers (last 6h)</div>
            <div className="narratives-list">
              {themes.map((t) => (
                <div key={t.theme} className="narrative-row">
                  <span className="narrative-theme">
                    {t.emoji && <span className="narrative-emoji">{t.emoji}</span>}
                    {t.theme}
                  </span>
                  <span className="narrative-arrow">·</span>
                  <span className="narrative-tickers">
                    {t.tickers.map((tk) => (
                      <span key={tk} className="narrative-ticker">{tk}</span>
                    ))}
                  </span>
                  <span className="narrative-count">{t.signals} signals</span>
                </div>
              ))}
            </div>
          </div>
        ) : graphSignals.length > 0 && (
          <div className="narratives-callout">
            <div className="narratives-label">🌀 Diverging narratives</div>
            <div className="narratives-empty">
              No cross-ticker narratives surfaced yet. The dictionary watches for tariffs, antitrust, EU regulation, AI infrastructure, layoffs, M&A, insider activity, and 12 more — they&apos;ll appear here as triggering headlines arrive.
            </div>
          </div>
        )}

        {summary.length > 0 && (
          <div className="dual-pane">
            <div className="pane-main">
              <h2>Watchlist · sentiment ring (last hour)</h2>
              <div className="grid">
                {summary.map((t) => {
                  const s = sentiments[t.ticker];
                  const border = s ? sentimentBorder(s.score) : "var(--border)";
                  return (
                    <div
                      key={t.ticker}
                      className="card"
                      style={{ borderColor: border, boxShadow: `0 0 0 1px ${border}` }}
                    >
                      <div className="ticker-row">
                        <span className="ticker">{t.ticker}</span>
                        <span className={`sentiment-chip ${s && s.score > 0 ? "pos" : s && s.score < 0 ? "neg" : ""}`}>
                          {sentimentLabel(s)}
                        </span>
                      </div>
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
                          <div className="l">srcs</div>
                        </div>
                      </div>
                      <div className="subtle" style={{ marginTop: 8, fontSize: 11 }}>
                        latest: {t.latest ? fmtTime(t.latest) : "—"}
                      </div>
                      <UnlockButton ticker={t.ticker} />
                    </div>
                  );
                })}
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
                      {s.summary && <div className="summary">{s.summary.slice(0, 240)}{s.summary.length > 240 ? "…" : ""}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="pane-side">
              <h2 className="reddit-header">
                <span className="dot-live" /> Reddit live · last 30 min
                <span className="reddit-count">{redditSignals.length}</span>
              </h2>
              <div className="reddit-feed">
                {redditSignals.length === 0 ? (
                  <div className="reddit-empty">No Reddit signals in the last 30 min. Worker polls every 15s.</div>
                ) : (
                  redditSignals.map((s, i) => (
                    <div key={i} className="reddit-item">
                      <div className="reddit-top">
                        <span className="ticker">{s.ticker}</span>
                        <span className="reddit-time">{fmtTimeSeconds(s.first_seen_at)}</span>
                      </div>
                      <div className="reddit-headline">
                        {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.headline}</a> : s.headline}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
