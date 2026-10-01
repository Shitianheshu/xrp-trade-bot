export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StrategyType =
  | "ema_crossover"
  | "rsi_reversion"
  | "macd"
  | "bollinger"
  | "combined";

export type Strategy = {
  type: StrategyType;
  params: {
    fastEma: number;
    slowEma: number;
    rsiPeriod: number;
    rsiOversold: number;
    rsiOverbought: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    bollingerPeriod: number;
    bollingerStdDev: number;
  };
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number | null;
  minConfidence: number;
};

export type Signal = { side: "buy" | "sell" | "hold"; confidence: number; message: string };
export type BacktestTrade = {
  entryTime: string; exitTime: string; entryPrice: number; exitPrice: number;
  netPnl: number; pnlPct: number; exitReason: string;
};
export type BacktestResult = {
  totalReturnPct: number; netProfit: number; grossProfit: number; grossLoss: number;
  winRate: number; lossRate: number; profitFactor: number; maxDrawdownPct: number;
  sharpeRatio: number; sortinoRatio: number; averageTrade: number; averageWin: number;
  averageLoss: number; tradeCount: number; largestWin: number; largestLoss: number;
  equityCurve: Array<{ time: string; equity: number }>; trades: BacktestTrade[];
};

const finite = (n: number, fallback = 0): number => Number.isFinite(n) ? n : fallback;
const period = (n: number): number => Math.max(1, Math.floor(finite(n, 1)));
const clean = (n: number): number => finite(n);

/** Aligned EMA values. Values before enough observations are NaN. */
export function ema(values: number[], length: number): number[] {
  const p = period(length), out = values.map(() => Number.NaN);
  if (values.length < p) return out;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += clean(values[i]);
  let previous = sum / p;
  out[p - 1] = previous;
  const multiplier = 2 / (p + 1);
  for (let i = p; i < values.length; i++) {
    previous = (clean(values[i]) - previous) * multiplier + previous;
    out[i] = previous;
  }
  return out;
}
export const calculateEMA = ema;

/** Wilder RSI, aligned to the input series. */
export function rsi(values: number[], length: number): number[] {
  const p = period(length), out = values.map(() => Number.NaN);
  if (values.length <= p) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const change = clean(values[i]) - clean(values[i - 1]);
    gain += Math.max(0, change); loss += Math.max(0, -change);
  }
  gain /= p; loss /= p;
  out[p] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  for (let i = p + 1; i < values.length; i++) {
    const change = clean(values[i]) - clean(values[i - 1]);
    gain = (gain * (p - 1) + Math.max(0, change)) / p;
    loss = (loss * (p - 1) + Math.max(0, -change)) / p;
    out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }
  return out.map(v => Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : v);
}
export const calculateRSI = rsi;

export function macd(values: number[], fast: number, slow: number, signal: number): {
  macd: number[]; signal: number[]; histogram: number[];
} {
  const fastLine = ema(values, fast), slowLine = ema(values, slow);
  const line = values.map((_, i) => Number.isFinite(fastLine[i]) && Number.isFinite(slowLine[i])
    ? fastLine[i] - slowLine[i] : Number.NaN);
  const first = line.findIndex(Number.isFinite);
  const signalLine = line.map(() => Number.NaN);
  if (first >= 0) {
    const calculated = ema(line.slice(first), signal);
    calculated.forEach((value, i) => { signalLine[first + i] = value; });
  }
  return { macd: line, signal: signalLine, histogram: line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signalLine[i]) ? v - signalLine[i] : Number.NaN) };
}
export const calculateMACD = macd;

export function bollinger(values: number[], length: number, deviations: number): {
  middle: number[]; upper: number[]; lower: number[];
} {
  const p = period(length), middle = values.map(() => Number.NaN);
  const upper = values.map(() => Number.NaN), lower = values.map(() => Number.NaN);
  const d = Math.max(0, finite(deviations));
  for (let i = p - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += clean(values[j]);
    const mean = sum / p;
    let variance = 0;
    for (let j = i - p + 1; j <= i; j++) variance += (clean(values[j]) - mean) ** 2;
    const sd = Math.sqrt(variance / p);
    middle[i] = mean; upper[i] = mean + d * sd; lower[i] = mean - d * sd;
  }
  return { middle, upper, lower };
}
export const calculateBollingerBands = bollinger;
export const calculateBollinger = bollinger;

function valuesFor(candles: Candle[]): number[] { return candles.map(c => clean(c.close)); }
function indicators(candles: Candle[], s: Strategy) {
  const closes = valuesFor(candles), p = s.params;
  return { closes, fast: ema(closes, p.fastEma), slow: ema(closes, p.slowEma),
    rsi: rsi(closes, p.rsiPeriod), macd: macd(closes, p.macdFast, p.macdSlow, p.macdSignal),
    bands: bollinger(closes, p.bollingerPeriod, p.bollingerStdDev) };
}

function decisionAt(i: number, data: ReturnType<typeof indicators>, s: Strategy): Signal {
  if (i < 1 || !Number.isFinite(data.closes[i])) return { side: "hold", confidence: 0, message: "Insufficient history" };
  const p = s.params, votes: Array<"buy" | "sell"> = [], reasons: string[] = [];
  const addCross = (a: number[], b: number[], label: string) => {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i]) && Number.isFinite(a[i - 1]) && Number.isFinite(b[i - 1])) {
      if (a[i] > b[i] && a[i - 1] <= b[i - 1]) { votes.push("buy"); reasons.push(`${label} bullish crossover`); }
      else if (a[i] < b[i] && a[i - 1] >= b[i - 1]) { votes.push("sell"); reasons.push(`${label} bearish crossover`); }
    }
  };
  if (s.type === "ema_crossover" || s.type === "combined") addCross(data.fast, data.slow, "EMA");
  if (s.type === "rsi_reversion" || s.type === "combined") {
    if (data.rsi[i] <= p.rsiOversold) { votes.push("buy"); reasons.push("RSI oversold"); }
    else if (data.rsi[i] >= p.rsiOverbought) { votes.push("sell"); reasons.push("RSI overbought"); }
  }
  if (s.type === "macd" || s.type === "combined") addCross(data.macd.macd, data.macd.signal, "MACD");
  if (s.type === "bollinger" || s.type === "combined") {
    if (data.closes[i] <= data.bands.lower[i]) { votes.push("buy"); reasons.push("below lower Bollinger band"); }
    else if (data.closes[i] >= data.bands.upper[i]) { votes.push("sell"); reasons.push("above upper Bollinger band"); }
  }
  const buys = votes.filter(v => v === "buy").length, sells = votes.length - buys;
  const side = buys > sells ? "buy" : sells > buys ? "sell" : "hold";
  const confidence = votes.length ? Math.min(1, Math.max(buys, sells) / votes.length) : 0;
  if (side === "hold" || confidence < Math.max(0, Math.min(1, finite(s.minConfidence)))) {
    return { side: "hold", confidence, message: reasons.length ? "Conflicting or low-confidence signals" : "No qualifying signal" };
  }
  return { side, confidence, message: reasons.join("; ") || "Qualifying signal" };
}

export function evaluateSignal(candles: Candle[], strategy: Strategy): Signal {
  if (!Array.isArray(candles) || candles.length < 2) return { side: "hold", confidence: 0, message: "Insufficient candle history" };
  return decisionAt(candles.length - 1, indicators(candles, strategy), strategy);
}

export function runBacktest(candles: Candle[], strategy: Strategy, initialCapital: number, feeBps: number, slippageBps: number): BacktestResult {
  const capital = Math.max(0, finite(initialCapital)), fee = Math.max(0, finite(feeBps)) / 10000;
  const slip = Math.max(0, finite(slippageBps)) / 10000, data = indicators(candles || [], strategy);
  const trades: BacktestTrade[] = [], equityCurve: Array<{ time: string; equity: number }> = [];
  let equity = capital, peak = capital, maxDd = 0;
  let pos: { side: "buy" | "sell"; entry: number; qty: number; time: string; entryIndex: number; high: number; low: number; entryFee: number } | null = null;
  const mark = (price: number) => pos ? equity + pos.qty * (price - pos.entry) * (pos.side === "buy" ? 1 : -1) : equity;
  const close = (c: Candle, price: number, reason: string) => {
    if (!pos) return;
    const exit = Math.max(0, finite(price)), gross = pos.qty * (exit - pos.entry) * (pos.side === "buy" ? 1 : -1);
    const exitFee = pos.qty * exit * fee, fees = pos.entryFee + exitFee, net = gross - fees;
    equity += gross - exitFee;
    trades.push({ entryTime: pos.time, exitTime: c.time, entryPrice: pos.entry, exitPrice: exit,
      netPnl: net, pnlPct: pos.entry ? net / (pos.qty * pos.entry) * 100 : 0, exitReason: reason });
    pos = null;
  };
  for (let i = 0; i < (candles || []).length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;
    if (pos && i > pos.entryIndex) {
      const stop = strategy.stopLossPct > 0 ? pos.entry * (1 + (pos.side === "buy" ? -1 : 1) * strategy.stopLossPct / 100) : -Infinity;
      const target = strategy.takeProfitPct > 0 ? pos.entry * (1 + (pos.side === "buy" ? 1 : -1) * strategy.takeProfitPct / 100) : Infinity;
      if (strategy.trailingStopPct != null && strategy.trailingStopPct > 0) {
        pos.high = Math.max(pos.high, c.high); pos.low = Math.min(pos.low, c.low);
      }
      const trailing = strategy.trailingStopPct && strategy.trailingStopPct > 0
        ? (pos.side === "buy" ? pos.high * (1 - strategy.trailingStopPct / 100) : pos.low * (1 + strategy.trailingStopPct / 100)) : -Infinity;
      const stopLevel = pos.side === "buy" ? Math.max(stop, trailing) : Math.min(stop, trailing);
      const hitStop = pos.side === "buy" ? c.low <= stopLevel : c.high >= stopLevel;
      const hitTarget = pos.side === "buy" ? c.high >= target : c.low <= target;
      // Stop wins ties and collisions: this is deliberately conservative.
      if (hitStop && Number.isFinite(stopLevel)) close(c, stopLevel * (pos.side === "buy" ? 1 - slip : 1 + slip), "stop_loss");
      else if (hitTarget && Number.isFinite(target)) close(c, target * (pos.side === "buy" ? 1 - slip : 1 + slip), "take_profit");
    }
    if (!pos && i < candles.length - 1) {
      const signal = decisionAt(i, data, strategy);
      if (signal.side !== "hold" && Number.isFinite(candles[i + 1].open) && candles[i + 1].open > 0) {
        const raw = candles[i + 1].open;
        const entry = raw * (signal.side === "buy" ? 1 + slip : 1 - slip);
        const qty = capital > 0 ? capital / entry : 0;
        const entryFee = qty * entry * fee;
        pos = { side: signal.side, entry, qty, time: candles[i + 1].time, entryIndex: i + 1, high: entry, low: entry, entryFee };
        equity -= entryFee;
      }
    }
    const marked = finite(mark(c.close), equity);
    peak = Math.max(peak, marked); maxDd = peak > 0 ? Math.max(maxDd, (peak - marked) / peak * 100) : maxDd;
    equityCurve.push({ time: c.time, equity: marked });
  }
  if (pos && candles.length) close(candles[candles.length - 1], candles[candles.length - 1].close * (pos.side === "buy" ? 1 - slip : 1 + slip), "end_of_data");
  if (candles.length && equityCurve.length) equityCurve[equityCurve.length - 1].equity = finite(equity);
  const pnls = trades.map(t => t.netPnl), wins = pnls.filter(v => v > 0), losses = pnls.filter(v => v < 0);
  const mean = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const variance = pnls.length ? pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / pnls.length : 0;
  const downside = pnls.filter(v => v < 0), downsideVar = pnls.length ? downside.reduce((a, b) => a + b * b, 0) / pnls.length : 0;
  const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0, sortino = downsideVar > 0 ? mean / Math.sqrt(downsideVar) : 0;
  const net = equity - capital;
  return { totalReturnPct: capital > 0 ? net / capital * 100 : 0, netProfit: net,
    grossProfit: wins.reduce((a, b) => a + b, 0), grossLoss: losses.reduce((a, b) => a + b, 0),
    winRate: trades.length ? wins.length / trades.length * 100 : 0, lossRate: trades.length ? losses.length / trades.length * 100 : 0,
    profitFactor: losses.length ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)) : 0,
    maxDrawdownPct: finite(maxDd), sharpeRatio: finite(sharpe), sortinoRatio: finite(sortino), averageTrade: finite(mean),
    averageWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0, averageLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    tradeCount: trades.length, largestWin: wins.length ? Math.max(...wins) : 0, largestLoss: losses.length ? Math.min(...losses) : 0, equityCurve, trades };
}