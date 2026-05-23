import type { Signal } from "./ch";

/**
 * Curated narrative dictionary. Each theme is a *story* that can span multiple
 * companies, with a list of trigger phrases (case-insensitive substring match
 * on headline+summary). Add or refine triggers as you see what's in the data.
 *
 * Designed so themes are interpretable on stage: "tariffs", "antitrust",
 * "EU regulation" — not raw word frequencies that surface company names.
 */
export type Narrative = { label: string; emoji?: string; triggers: string[] };

export const NARRATIVES: Narrative[] = [
  {
    label: "tariffs & trade war",
    emoji: "🛃",
    triggers: ["tariff", "trade war", "import duty", "import tax", "duties on", "section 301"],
  },
  {
    label: "EU regulation",
    emoji: "🇪🇺",
    triggers: ["european union", " eu ", "brussels", "european commission", "dsa ", "dma ", "gdpr", "eu antitrust", "eu fine", "eu probe"],
  },
  {
    label: "antitrust & monopoly",
    emoji: "⚖️",
    triggers: ["antitrust", "monopoly", "anticompetitive", "anti-competitive", "doj suit", "ftc complaint", "competition probe"],
  },
  {
    label: "China & geopolitics",
    emoji: "🇨🇳",
    triggers: ["china", "beijing", "taiwan", "huawei", "tencent", "alibaba", "chinese government", "xi jinping"],
  },
  {
    label: "AI infrastructure & GPUs",
    emoji: "🧠",
    triggers: ["ai infrastructure", "ai compute", "ai chip", "ai chips", "gpu", "data center", "hyperscaler", "h100", "h200", "blackwell", "ai training", "ai capex"],
  },
  {
    label: "lawsuits & litigation",
    emoji: "🧑‍⚖️",
    triggers: ["lawsuit", "sued", " sues ", "litigation", "class action", "court ruling", "settlement", "damages"],
  },
  {
    label: "layoffs & restructuring",
    emoji: "👋",
    triggers: ["layoff", "layoffs", "job cut", "job cuts", "workforce reduction", "restructur", "headcount", "fired thousands"],
  },
  {
    label: "executive change",
    emoji: "🪑",
    triggers: ["new ceo", "step down", "stepping down", "resign", "appoint", "appointed", "succession", "departure of", "replaces ceo"],
  },
  {
    label: "earnings beat & guidance raise",
    emoji: "📈",
    triggers: ["beat estimates", "beat expectations", "exceed expectations", "exceeded expectations", "raised guidance", "raises guidance", "raise outlook", "raised outlook", "tops estimate"],
  },
  {
    label: "earnings miss & guide cut",
    emoji: "📉",
    triggers: ["missed estimates", "miss estimates", "missed expectations", "cut guidance", "lowered guidance", "lower outlook", "warning", "profit warning"],
  },
  {
    label: "insider activity (Form 4)",
    emoji: "🔎",
    triggers: ["form 4", "insider sold", "insider buy", "insider purchase", "10b5-1", "beneficial ownership", "rule 144"],
  },
  {
    label: "M&A and acquisitions",
    emoji: "🤝",
    triggers: ["acquired", "acquisition of", "acquire ", "merger", "merging with", "takeover", "buyout", "to buy"],
  },
  {
    label: "regulatory probe",
    emoji: "🚨",
    triggers: ["probe", "investigation", "subpoena", "sec investigation", "doj investigation", "regulators are", "scrutiny over"],
  },
  {
    label: "privacy & data breach",
    emoji: "🔐",
    triggers: ["data breach", "leaked data", "privacy violation", "user data", "hacked", "ransomware", "cyberattack"],
  },
  {
    label: "AI ethics & safety",
    emoji: "🛡️",
    triggers: ["ai safety", "ai ethics", "ai regulation", "ai oversight", "deepfake", "ai-generated", "responsible ai", "ai bias"],
  },
  {
    label: "buybacks & dividends",
    emoji: "💰",
    triggers: ["share buyback", "share repurchase", "dividend increase", "increased dividend", "raised dividend", "$ billion buyback"],
  },
  {
    label: "Apple ecosystem (App Store)",
    emoji: "🍎",
    triggers: ["app store fee", "app store policy", "third-party app store", "apple tax", "alternative app store", "apple commission"],
  },
  {
    label: "OpenAI partnership/conflict",
    emoji: "🤖",
    triggers: ["openai", "sam altman", "chatgpt deal", "openai partnership", "openai contract"],
  },
];

export type CrossTickerTheme = {
  theme: string;        // display label
  emoji?: string;
  tickers: string[];
  signals: number;
};

function matchNarratives(text: string): Narrative[] {
  const lower = " " + text.toLowerCase() + " ";
  return NARRATIVES.filter((n) => n.triggers.some((t) => lower.includes(t)));
}

/**
 * Match each signal against the curated narrative dictionary, then aggregate:
 * which narratives span which tickers. Returns themes with 2..6 overlapping
 * tickers, ranked by ticker-count × signal-density. Demo-friendly because
 * the labels are real story names, not raw word counts.
 */
export function crossTickerThemes(signals: Signal[], topN = 6): CrossTickerTheme[] {
  const byTheme = new Map<string, { emoji?: string; tickers: Set<string>; count: number }>();
  for (const s of signals) {
    const text = s.headline + " " + (s.summary ?? "");
    const hits = matchNarratives(text);
    for (const n of hits) {
      let entry = byTheme.get(n.label);
      if (!entry) {
        entry = { emoji: n.emoji, tickers: new Set(), count: 0 };
        byTheme.set(n.label, entry);
      }
      entry.tickers.add(s.ticker);
      entry.count += 1;
    }
  }
  return Array.from(byTheme.entries())
    .map(([label, e]) => ({
      theme: label,
      emoji: e.emoji,
      tickers: Array.from(e.tickers).sort(),
      signals: e.count,
    }))
    // Real cross-narratives: 2..6 tickers (per spec), minimum 2 supporting signals
    .filter((t) => t.tickers.length >= 2 && t.tickers.length <= 6 && t.signals >= 2)
    .sort((a, b) => {
      // Rank: more overlapping tickers wins; ties broken by signal density.
      if (b.tickers.length !== a.tickers.length) return b.tickers.length - a.tickers.length;
      return b.signals / b.tickers.length - a.signals / a.tickers.length;
    })
    .slice(0, topN);
}

// Kept for backward compatibility (the narrative graph imports it). Tokenizer
// for the graph's "theme" nodes still works as before; only the diverging
// callout uses the curated dictionary.
export const STOPWORDS = new Set([
  "about", "above", "across", "after", "again", "against", "ahead", "along",
  "already", "also", "always", "among", "another", "around", "based", "back",
  "because", "become", "becomes", "before", "behind", "being", "below", "beside",
  "between", "beyond", "both", "called", "calls", "could", "doing", "done",
  "during", "early", "earlier", "either", "enough", "every", "expects",
  "first", "found", "going", "happens", "having", "heads", "here", "however",
  "include", "includes", "instead", "into", "itself", "just", "keep", "kind",
  "later", "least", "less", "likely", "long", "longer", "looking",
  "make", "makes", "many", "maybe", "might", "more", "most", "much", "must",
  "near", "never", "newer", "newly", "next", "often", "once", "only", "onto",
  "open", "other", "others", "over", "part", "plans", "really", "right",
  "rights", "same", "says", "said", "seem", "seems", "sets", "shall",
  "should", "show", "shows", "side", "simple", "since", "small", "some",
  "soon", "still", "such", "take", "takes", "taken", "talk", "talks", "than",
  "that", "their", "them", "then", "there", "these", "they", "thing", "things",
  "think", "this", "those", "thought", "three", "through", "told", "tomorrow",
  "tough", "true", "under", "until", "upon", "used", "uses", "using", "very",
  "wants", "well", "what", "when", "where", "which", "while", "whose",
  "with", "within", "without", "would", "your", "yours",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december",
  "today", "yesterday", "tonight", "morning", "afternoon", "evening", "night",
  "week", "weeks", "month", "months", "year", "years", "decade",
  "amid", "ahead", "post", "pre",
  "share", "shares", "stock", "stocks", "company", "companies", "corporation",
  "market", "markets", "price", "prices", "quarter", "quarterly", "annual",
  "earnings", "revenue", "report", "reports", "investor", "investors",
  "analyst", "analysts", "trader", "traders", "trading", "trade", "trades",
  "trend", "trends", "high", "higher", "highest", "low", "lower", "lowest",
  "deal", "deals", "news", "story", "stories", "update", "updates", "major",
  "minor", "good", "best", "great", "large", "huge", "little", "biggest",
  "outlook", "forecast", "guidance", "results", "result", "performance",
  "growth", "valuation", "value", "estimate", "estimates", "target", "targets",
  "session", "premarket", "aftermarket", "close", "closed",
  "shareholder", "shareholders", "investing", "invest", "investment",
  "asset", "assets", "fund", "funds", "broker", "brokerage", "rating",
  "ratings", "level", "levels", "data", "datum",
  "chief", "executive", "officer", "officers", "director", "directors",
  "board", "founder", "founders", "president", "vice", "senior", "junior",
  "head", "lead", "manager", "team",
  "bloomberg", "yahoo", "reuters", "press", "release", "released",
  "filing", "filed", "files", "current", "items", "section", "sections",
  "announce", "announced", "announces", "reported",
  "reveal", "revealed", "reveals", "expect", "expected",
  "begin", "began", "begun", "start", "started", "ends", "ended",
  // company names — would trivially surface as "themes" otherwise
  "apple", "microsoft", "google", "alphabet", "meta", "facebook", "nvidia",
  "datadog", "amazon", "tesla", "intel", "openai", "anthropic",
  "intelligence", "artificial",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 4 && !STOPWORDS.has(t));
}
