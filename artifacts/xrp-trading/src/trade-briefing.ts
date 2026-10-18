import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getGetBacktestsQueryKey,
  getGetMarketOhlcvQueryKey,
  getGetPaperValidationQueryKey,
  getGetStrategiesQueryKey,
  getGetTradingDashboardQueryKey,
  getGetTradingStatusQueryKey,
  useGetBacktests,
  useGetMarketOhlcv,
  useGetPaperValidation,
  useGetStrategies,
  useGetTradingDashboard,
  useGetTradingStatus,
  type BacktestSummary,
  type Candle,
  type MarketTicker,
  type PaperValidationCheck,
  type Strategy,
  type TradingStatus,
} from '@workspace/api-client-react';

export type BriefingVerdict = 'ready' | 'wait' | 'blocked';
export type FactorStatus = 'passed' | 'pending' | 'blocked';

export type BriefingFactor = {
  id: string;
  label: string;
  status: FactorStatus;
  detail: string;
};

export type BriefingArticle = {
  id: string;
  kind: 'note' | 'reference';
  title: string;
  source: string;
  summary: string;
  href?: string;
  minutes: number;
};

export type ActionSide = 'buy' | 'sell' | 'hold';

export type BriefingAction = {
  side: ActionSide;
  allowed: boolean;
  headline: string;
  detail: string;
  confidence: number;
  strategyName: string | null;
};

export type TradeBriefing = {
  verdict: BriefingVerdict;
  headline: string;
  summary: string;
  alertTitle: string;
  alertBody: string;
  symbol: string;
  action: BriefingAction;
  factors: BriefingFactor[];
  articles: BriefingArticle[];
  stats: {
    changePct24h: number | null;
    rangePct: number | null;
    hourlyVolPct: number | null;
    fearValue: number | null;
    fearLabel: string | null;
  };
};

type FearReading = { value: number; label: string };

const VERDICT_RANK: Record<BriefingVerdict, number> = { ready: 0, wait: 1, blocked: 2 };
const ALERT_KEY = 'xrpq-briefing-verdict';
export type AnalysisAction = {
  side: ActionSide;
  confidence: number;
  message: string;
  strategyName: string | null;
  interval: string | null;
  symbol: string;
};

function buildAction(verdict: BriefingVerdict, symbol: string, reading: AnalysisAction | null): BriefingAction {
  const side = reading?.side ?? 'hold';
  const confidence = reading?.confidence ?? 0;
  const allowed = verdict === 'ready' && (side === 'buy' || side === 'sell');
  const label = side === 'buy' ? 'Buy' : side === 'sell' ? 'Sell' : '';
  const model = reading?.strategyName
    ? `${reading.strategyName}${reading.interval ? ` ${reading.interval}` : ''}`
    : 'the active strategy';
  const reason = reading?.message || 'No qualifying signal.';
  const confidenceText = side === 'hold' ? '' : ` Confidence ${Math.round(confidence * 100)}%.`;
  if (allowed) {
    return {
      side,
      allowed: true,
      headline: `Now it's okay to ${label}`,
      detail: `${symbol} · ${model}. ${reason}.${confidenceText} Paper only.`,
      confidence,
      strategyName: reading?.strategyName ?? null,
    };
  }
  if (side === 'buy' || side === 'sell') {
    return {
      side,
      allowed: false,
      headline: `Not okay to ${label} yet`,
      detail: `${model} leans ${label}, but the start check is not clear. ${reason}.${confidenceText}`,
      confidence,
      strategyName: reading?.strategyName ?? null,
    };
  }
  return {
    side: 'hold',
    allowed: false,
    headline: 'No Buy or Sell call right now',
    detail: `${symbol}. ${reason}`,
    confidence,
    strategyName: reading?.strategyName ?? null,
  };
}

function rangePct(ticker?: MarketTicker | null) {
  if (!ticker || ticker.low24h <= 0) return null;
  return ((ticker.high24h - ticker.low24h) / ticker.low24h) * 100;
}

function hourlyVolPct(candles: Candle[] = []) {
  if (candles.length < 12) return null;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1]?.close;
    const next = candles[i]?.close;
    if (prev && next) returns.push((next - prev) / prev);
  }
  if (returns.length < 8) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function worse(current: BriefingVerdict, next: BriefingVerdict): BriefingVerdict {
  return VERDICT_RANK[next] > VERDICT_RANK[current] ? next : current;
}

function factorVerdict(factor: BriefingFactor): BriefingVerdict {
  if (factor.status === 'blocked') return 'blocked';
  if (factor.status === 'pending') return 'wait';
  return 'ready';
}

export function buildTradeBriefing(input: {
  symbol: string;
  ticker?: MarketTicker | null;
  candles?: Candle[];
  strategies?: Strategy[];
  trading?: TradingStatus | null;
  checks?: PaperValidationCheck[];
  backtest?: BacktestSummary | null;
  fear?: FearReading | null;
  action?: AnalysisAction | null;
}): TradeBriefing {
  const ticker = input.ticker;
  const strategies = input.strategies ?? [];
  const active = strategies.find(item => item.active) ?? null;
  const checks = input.checks ?? [];
  const marketCheck = checks.find(item => item.id === 'market-feed');
  const storageCheck = checks.find(item => item.id === 'database');
  const riskCheck = checks.find(item => item.id === 'risk-controls');
  const move = ticker?.changePct24h ?? null;
  const span = rangePct(ticker);
  const vol = hourlyVolPct(input.candles);
  const fear = input.fear ?? null;
  const factors: BriefingFactor[] = [];

  if (!ticker) {
    factors.push({ id: 'feed', label: 'Live price', status: 'blocked', detail: 'No current ticker is available for this pair.' });
  } else if (ticker.stale || marketCheck?.status === 'blocked') {
    factors.push({ id: 'feed', label: 'Live price', status: 'blocked', detail: marketCheck?.detail ?? `${ticker.symbol} is marked stale, so a start would be guessing.` });
  } else {
    factors.push({ id: 'feed', label: 'Live price', status: 'passed', detail: `${ticker.exchange} ${ticker.symbol} is current at ${ticker.price}.` });
  }

  if (span == null || move == null) {
    factors.push({ id: 'range', label: '24h range', status: 'pending', detail: 'The 24 hour range is not available yet.' });
  } else if (span > 8 || Math.abs(move) > 6) {
    factors.push({ id: 'range', label: '24h range', status: 'pending', detail: `The session spans ${span.toFixed(2)}% and the 24h move is ${move.toFixed(2)}%. Wait for a calmer tape.` });
  } else {
    factors.push({ id: 'range', label: '24h range', status: 'passed', detail: `The session spans ${span.toFixed(2)}% with a ${move.toFixed(2)}% 24h move.` });
  }

  if (input.candles == null) {
    factors.push({ id: 'vol', label: 'Hourly volatility', status: 'passed', detail: 'Hourly volatility is still loading and is not part of this verdict yet.' });
  } else if (vol == null) {
    factors.push({ id: 'vol', label: 'Hourly volatility', status: 'pending', detail: 'Not enough hourly candles yet to measure short-term volatility.' });
  } else if (vol > 2) {
    factors.push({ id: 'vol', label: 'Hourly volatility', status: 'pending', detail: `Typical hourly move is ${vol.toFixed(2)}%. That is fast for a fresh start.` });
  } else {
    factors.push({ id: 'vol', label: 'Hourly volatility', status: 'passed', detail: `Typical hourly move is ${vol.toFixed(2)}%.` });
  }

  if (!fear) {
    factors.push({ id: 'fear', label: 'Market mood', status: 'passed', detail: 'The fear and greed reading is unavailable, so it is not blocking a start.' });
  } else if (fear.value >= 80 || fear.value <= 20) {
    factors.push({ id: 'fear', label: 'Market mood', status: 'pending', detail: `Crypto fear and greed is ${fear.value} (${fear.label}). Extreme mood is a reason to wait.` });
  } else {
    factors.push({ id: 'fear', label: 'Market mood', status: 'passed', detail: `Crypto fear and greed is ${fear.value} (${fear.label}).` });
  }

  if (storageCheck?.status === 'blocked') {
    factors.push({ id: 'storage', label: 'Paper records', status: 'blocked', detail: storageCheck.detail });
  } else {
    factors.push({ id: 'storage', label: 'Paper records', status: 'passed', detail: storageCheck?.detail ?? 'Account state is stored for this desk.' });
  }

  if (riskCheck?.status === 'blocked') {
    factors.push({ id: 'risk', label: 'Risk limits', status: 'blocked', detail: riskCheck.detail });
  } else {
    factors.push({ id: 'risk', label: 'Risk limits', status: 'passed', detail: riskCheck?.detail ?? 'Position, loss, and trade limits are in place.' });
  }

  if (!strategies.length) {
    factors.push({ id: 'strategy', label: 'Strategy', status: 'blocked', detail: 'Create a paper strategy before starting the bot.' });
  } else if (!active) {
    factors.push({ id: 'strategy', label: 'Strategy', status: 'pending', detail: `${strategies.length} strategies exist, and none is active.` });
  } else {
    factors.push({ id: 'strategy', label: 'Strategy', status: 'passed', detail: `${active.name} is active on ${active.symbol} ${active.interval}.` });
  }

  const backtest = input.backtest;
  if (!backtest) {
    factors.push({ id: 'backtest', label: 'Latest backtest', status: 'passed', detail: 'No completed backtest is on file. A start can still be paper-only.' });
  } else if (backtest.maxDrawdownPct > 30 || backtest.totalReturnPct < -15) {
    factors.push({ id: 'backtest', label: 'Latest backtest', status: 'pending', detail: `${backtest.strategyName} returned ${backtest.totalReturnPct.toFixed(2)}% with ${backtest.maxDrawdownPct.toFixed(2)}% drawdown. Review it before starting.` });
  } else {
    factors.push({ id: 'backtest', label: 'Latest backtest', status: 'passed', detail: `${backtest.strategyName} returned ${backtest.totalReturnPct.toFixed(2)}% with ${backtest.maxDrawdownPct.toFixed(2)}% drawdown.` });
  }

  if (input.trading?.emergencyStop) {
    factors.push({ id: 'halt', label: 'Engine halt', status: 'blocked', detail: input.trading.message || 'Emergency halt is on. Clear it before any new paper orders.' });
  } else if (input.trading?.state === 'running') {
    factors.push({ id: 'halt', label: 'Engine halt', status: 'passed', detail: 'The paper engine is already running.' });
  } else {
    factors.push({ id: 'halt', label: 'Engine halt', status: 'passed', detail: 'The paper engine is stopped and can be started. Orders stay simulated.' });
  }

  const verdict = factors.reduce<BriefingVerdict>((current, item) => worse(current, factorVerdict(item)), 'ready');
  const headline = verdict === 'ready'
    ? 'Now it\'s okay for you to start to trade'
    : verdict === 'wait'
      ? 'Wait before you start'
      : 'Do not start yet';
  const holding = factors.filter(item => factorVerdict(item) === verdict);
  const reason = holding[0]?.detail ?? factors[0]?.detail ?? 'The desk does not have a complete snapshot.';
  const summary = verdict === 'ready'
    ? `${input.symbol} passed the paper start checks. ${reason} Starting the bot places simulated orders only.`
    : `${headline.replace(/\.$/, '')}. ${reason}`;
  const alertTitle = verdict === 'ready' ? 'Now it\'s okay for you to start to trade' : headline;
  const alertBody = `${input.symbol}: ${reason}`;

  return {
    verdict,
    headline,
    summary,
    alertTitle,
    alertBody,
    symbol: input.symbol,
    action: buildAction(verdict, input.symbol, input.action ?? null),
    factors,
    articles: articlesFor(verdict, input.symbol, fear),
    stats: {
      changePct24h: move,
      rangePct: span,
      hourlyVolPct: vol,
      fearValue: fear?.value ?? null,
      fearLabel: fear?.label ?? null,
    },
  };
}

function articlesFor(verdict: BriefingVerdict, symbol: string, fear: FearReading | null): BriefingArticle[] {
  const notes: Record<BriefingVerdict, BriefingArticle[]> = {
    ready: [
      {
        id: 'note-start',
        kind: 'note',
        title: 'What “okay to start” means on this desk',
        source: 'XRP TradeBot',
        minutes: 3,
        summary: `The ${symbol} feed is current, the session is not stretched, risk limits are in place, and the halt is clear. Press Start Bot when you want the paper engine to evaluate the active strategy. Nothing in this check sends a live exchange order.`,
      },
      {
        id: 'note-after-start',
        kind: 'note',
        title: 'What to watch in the first hour',
        source: 'XRP TradeBot',
        minutes: 2,
        summary: 'After the start, watch the open position, the stop, and the signal list. If the feed goes stale or the daily loss cap is hit, the engine should stop creating new entries. Use Stop Bot if the tape changes faster than the backtest you trust.',
      },
    ],
    wait: [
      {
        id: 'note-wait',
        kind: 'note',
        title: 'Why a fast tape is a reason to wait',
        source: 'XRP TradeBot',
        minutes: 3,
        summary: `A wide ${symbol} range, a sharp 24 hour move, extreme market mood, or a weak backtest means the next paper entries would be made in noisy conditions. Waiting does not freeze the account. It keeps new simulated orders off until the listed item clears.`,
      },
      {
        id: 'note-review',
        kind: 'note',
        title: 'A short review before the next start',
        source: 'XRP TradeBot',
        minutes: 2,
        summary: 'Confirm the active strategy symbol matches the chart, the stop is inside the 25% limit, and the latest backtest drawdown is one you would still accept. Then return here. The headline changes when the wait items pass.',
      },
    ],
    blocked: [
      {
        id: 'note-blocked',
        kind: 'note',
        title: 'What is holding the start',
        source: 'XRP TradeBot',
        minutes: 3,
        summary: 'A blocked check is a hard stop: missing prices, a halted engine, no strategy, or risk limits that failed validation. Clearing the red item is the only path to the start message. The paper book stays as it is until then.',
      },
      {
        id: 'note-halt',
        kind: 'note',
        title: 'How to leave an emergency halt',
        source: 'XRP TradeBot',
        minutes: 2,
        summary: 'Open Trading and press Start Bot only after you have read the halt reason. Start clears the emergency flag and lets the active strategy place paper orders again. If you do not want that yet, leave the halt on.',
      },
    ],
  };
  const mood = fear
    ? `The latest crypto fear and greed reading is ${fear.value}, classified as ${fear.label}.`
    : 'The fear and greed index is the market-mood reference used beside the XRP tape.';
  const references: BriefingArticle[] = [
    {
      id: 'ref-xrpl',
      kind: 'reference',
      title: 'What the XRP Ledger is',
      source: 'XRPL.org',
      minutes: 6,
      href: 'https://xrpl.org/docs/introduction/what-is-the-xrp-ledger',
      summary: 'Primary documentation for the ledger behind XRP: payments, consensus, and why the asset exists apart from the trading desk.',
    },
    {
      id: 'ref-ripple',
      kind: 'reference',
      title: 'Ripple insights',
      source: 'Ripple',
      minutes: 5,
      href: 'https://ripple.com/insights/',
      summary: 'Ripple’s own writing on payments, policy, and XRP. Use it as background, not as a signal to start.',
    },
    {
      id: 'ref-mood',
      kind: 'reference',
      title: 'Crypto fear and greed index',
      source: 'Alternative.me',
      minutes: 2,
      href: 'https://alternative.me/crypto/fear-and-greed-index/',
      summary: mood,
    },
    {
      id: 'ref-gecko',
      kind: 'reference',
      title: 'XRP market profile',
      source: 'CoinGecko',
      minutes: 4,
      href: 'https://www.coingecko.com/en/coins/ripple',
      summary: 'Live XRP profile, community links, and market statistics from an independent data site.',
    },
  ];
  return [...notes[verdict], ...references];
}

async function fetchFearGreed(): Promise<FearReading | null> {
  const response = await fetch('https://api.alternative.me/fng/?limit=1');
  if (!response.ok) return null;
  const body = await response.json() as { data?: Array<{ value?: string; value_classification?: string }> };
  const row = body.data?.[0];
  const value = Number(row?.value);
  if (!row || !Number.isFinite(value)) return null;
  return { value, label: row.value_classification || 'Unknown' };
}

export function useTradeBriefing(symbol: string, ticker?: MarketTicker) {
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;
  const [sampledTicker, setSampledTicker] = useState(ticker);
  useEffect(() => {
    setSampledTicker(tickerRef.current);
    const timer = window.setInterval(() => setSampledTicker(tickerRef.current), 60_000);
    return () => window.clearInterval(timer);
  }, [symbol]);
  const dashboard = useGetTradingDashboard({ query: { queryKey: getGetTradingDashboardQueryKey(), refetchInterval: 60_000 } });
  const validation = useGetPaperValidation({ query: { queryKey: getGetPaperValidationQueryKey(), refetchInterval: 60_000 } });
  const strategies = useGetStrategies({ query: { queryKey: getGetStrategiesQueryKey(), refetchInterval: 60_000 } });
  const status = useGetTradingStatus({ query: { queryKey: getGetTradingStatusQueryKey(), refetchInterval: 30_000 } });
  const backtests = useGetBacktests({ query: { queryKey: getGetBacktestsQueryKey(), refetchInterval: 120_000 } });
  const candleParams = { symbol, interval: '1h' as const, limit: 48 };
  const candles = useGetMarketOhlcv(candleParams, { query: { queryKey: getGetMarketOhlcvQueryKey(candleParams), refetchInterval: 60_000 } });
  const action = useQuery({
    queryKey: ['analysis', 'action', symbol],
    queryFn: () => fetchAnalysisAction(symbol),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const fear = useQuery({
    queryKey: ['market', 'fear-greed'],
    queryFn: fetchFearGreed,
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const latestBacktest = useMemo(() => {
    const rows = backtests.data ?? [];
    return [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  }, [backtests.data]);
  const loading = (dashboard.isLoading && !dashboard.data) || (validation.isLoading && !validation.data) || (strategies.isLoading && !strategies.data) || (action.isLoading && !action.data);
  const briefing = useMemo(() => {
    if (loading) return null;
    return buildTradeBriefing({
      symbol,
      ticker: sampledTicker ?? dashboard.data?.ticker,
      candles: candles.isLoading && !candles.data ? undefined : candles.data ?? [],
      strategies: strategies.data,
      trading: status.data ?? dashboard.data?.trading,
      checks: validation.data?.checks,
      backtest: latestBacktest,
      fear: fear.data,
      action: action.data ?? null,
    });
  }, [loading, symbol, sampledTicker, dashboard.data, candles.data, strategies.data, status.data, validation.data, latestBacktest, fear.data, action.data]);
  return {
    briefing,
    loading,
    error: Boolean(dashboard.isError && !dashboard.data),
    refetch: () => {
      void dashboard.refetch();
      void validation.refetch();
      void strategies.refetch();
      void status.refetch();
      void backtests.refetch();
      void candles.refetch();
      void fear.refetch();
      void action.refetch();
    },
  };
}

async function fetchAnalysisAction(symbol: string): Promise<AnalysisAction> {
  const response = await fetch(`/api/analysis/action?symbol=${encodeURIComponent(symbol)}`);
  if (!response.ok) {
    return { side: 'hold', confidence: 0, message: 'The buy or sell call could not be loaded.', strategyName: null, interval: null, symbol };
  }
  const body = await response.json() as Partial<AnalysisAction>;
  const side = body.side === 'buy' || body.side === 'sell' ? body.side : 'hold';
  return {
    side,
    confidence: typeof body.confidence === 'number' ? body.confidence : 0,
    message: typeof body.message === 'string' ? body.message : 'No qualifying signal.',
    strategyName: typeof body.strategyName === 'string' ? body.strategyName : null,
    interval: typeof body.interval === 'string' ? body.interval : null,
    symbol: typeof body.symbol === 'string' ? body.symbol : symbol,
  };
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export function showActionNotification(briefing: TradeBriefing, onOpen: () => void) {
  if (!briefing.action.allowed || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const note = new Notification(briefing.action.headline, {
    body: briefing.action.detail,
    tag: 'xrpq-trade-action',
    lang: 'en',
  });
  note.onclick = () => {
    window.focus();
    onOpen();
    note.close();
  };
}

export function showTradeNotification(briefing: TradeBriefing, onOpen: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const note = new Notification(briefing.alertTitle, {
    body: briefing.alertBody,
    tag: 'xrpq-trade-readiness',
    lang: 'en',
  });
  note.onclick = () => {
    window.focus();
    onOpen();
    note.close();
  };
}

type AlarmSignal = { id: string; side: string; symbol: string; message: string; rejectionReason?: string | null };

export function useTradeAlerts(symbol: string, ticker?: MarketTicker, _signals?: AlarmSignal[]) {
  return useTradeBriefing(symbol, ticker);
}

export async function enableWindowsAlerts(briefing: TradeBriefing | null, onOpen: () => void) {
  if (typeof Notification === 'undefined') return 'unsupported' as const;
  const permission = await Notification.requestPermission();
  if (permission === 'granted' && briefing) {
    localStorage.setItem(ALERT_KEY, briefing.verdict);
    showTradeNotification(briefing, onOpen);
  }
  return permission;
}
