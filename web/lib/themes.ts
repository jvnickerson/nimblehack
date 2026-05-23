import type { Signal } from "./ch";

export const STOPWORDS = new Set([
  "about", "after", "again", "against", "almost", "among", "around", "because",
  "before", "being", "below", "between", "could", "doing", "during", "every",
  "first", "found", "going", "having", "into", "later", "least", "likely",
  "might", "most", "much", "never", "other", "over", "really", "same", "shall",
  "shares", "should", "since", "some", "such", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "those", "thought", "through",
  "today", "under", "until", "very", "where", "which", "while", "with", "would",
  "year", "years", "your", "yours",
  "stock", "stocks", "company", "companies", "market", "markets", "price", "prices",
  "quarter", "earnings", "revenue", "report", "reports", "investor", "investors",
  "bloomberg", "yahoo", "reuters", "press", "release",
  "filing", "filed", "current", "annual", "items", "section", "sections",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 4 && !STOPWORDS.has(t));
}

export type CrossTickerTheme = { theme: string; tickers: string[]; signals: number };

/**
 * Find tokens appearing in headlines across 2+ tickers — the cross-narrative overlap.
 * Sorted by ticker-set size desc, then signal frequency desc.
 */
export function crossTickerThemes(signals: Signal[], topN = 6): CrossTickerTheme[] {
  const tickerSets = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const s of signals) {
    const tokens = new Set(tokenize(s.headline + " " + (s.summary ?? "")));
    for (const t of tokens) {
      if (!tickerSets.has(t)) tickerSets.set(t, new Set());
      tickerSets.get(t)!.add(s.ticker);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(tickerSets.entries())
    .filter(([_, set]) => set.size >= 2)
    .map(([theme, set]) => ({
      theme,
      tickers: Array.from(set).sort(),
      signals: counts.get(theme) ?? 0,
    }))
    .sort((a, b) => b.tickers.length - a.tickers.length || b.signals - a.signals)
    .slice(0, topN);
}
