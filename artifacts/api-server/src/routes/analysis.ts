import { Router, type IRouter } from "express";
import { strategies } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { getExchangeAdapter, MarketDataError } from "../lib/market-data";
import { evaluateSignal, type Strategy, type StrategyType } from "../lib/trading-math";

const router: IRouter = Router();
router.use(requireAuth);

const SYMBOL = /^[A-Z0-9]{2,14}\/[A-Z0-9]{2,10}$/;
const TYPES = new Set<StrategyType>(["ema_crossover", "rsi_reversion", "macd", "bollinger", "combined"]);

function hold(symbol: string, message: string) {
  return { side: "hold" as const, confidence: 0, message, strategyName: null, interval: null, symbol };
}

router.get("/analysis/action", async (req, res): Promise<void> => {
  const raw = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : "";
  const symbol = SYMBOL.test(raw) ? raw : (process.env.TRADING_SYMBOL ?? "XRP/USDT");
  const saved = await strategies.listByUser(authenticatedUserId(res));
  const strategy = saved.find(item => item.active) ?? null;
  if (!strategy || !TYPES.has(strategy.type as StrategyType)) {
    res.json(hold(symbol, strategy ? "The active strategy type cannot make a buy or sell call." : "No active strategy, so there is no buy or sell call."));
    return;
  }
  const model: Strategy = {
    type: strategy.type as StrategyType,
    params: strategy.params,
    stopLossPct: strategy.stopLossPct,
    takeProfitPct: strategy.takeProfitPct,
    trailingStopPct: strategy.trailingStopPct,
    minConfidence: strategy.minConfidence,
  };
  try {
    const candles = await getExchangeAdapter().candles(symbol, strategy.interval, 240);
    const signal = evaluateSignal(candles, model);
    res.json({
      side: signal.side,
      confidence: signal.confidence,
      message: signal.message,
      strategyName: strategy.name,
      interval: strategy.interval,
      symbol,
    });
  } catch (error) {
    const message = error instanceof MarketDataError
      ? error.message
      : "The candle feed could not produce a buy or sell call.";
    res.json(hold(symbol, message));
  }
});

export default router;
