import { Router, type IRouter } from "express";
import {
  EmergencyStopTradingResponse,
  GetOrdersQueryParams,
  GetOrdersResponse,
  GetPaperValidationResponse,
  GetPortfolioResponse,
  GetPositionsResponse,
  GetSignalsQueryParams,
  GetSignalsResponse,
  GetTradesQueryParams,
  GetTradesResponse,
  GetTradingDashboardResponse,
  GetTradingStatusResponse,
  UpdateRiskSettingsBody,
  UpdateRiskSettingsResponse,
  GetRiskSettingsResponse,
  StartPaperTradingBody,
  StartPaperTradingResponse,
  StopPaperTradingResponse,
} from "@workspace/api-zod";
import {
  accounts,
  orders,
  pingDatabase,
  positions,
  signals,
  strategies,
  trades,
  type PaperOrder,
  type PaperPosition,
  type PaperTrade,
  type StrategyRecord,
  type TradingSignal,
} from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { getExchangeAdapter } from "../lib/market-data";
import {
  ensureUserAccount,
} from "../lib/trading-store";
import {
  getTradingStatus,
  closeManualPaperPositions,
  placePaperBuyForQuote,
  readVirtualStake,
  setVirtualStake,
  startPaperTrading,
  stopPaperTrading,
} from "../lib/paper-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

function serializeStrategy(strategy: StrategyRecord | null) {
  if (!strategy) return null;
  return {
    ...strategy,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  };
}

function serializePosition(position: PaperPosition, markPrice: number) {
  const marketValue = position.quantity * markPrice;
  const pnl = (markPrice - position.entryPrice) * position.quantity - position.entryFee;
  return {
    id: position.id,
    symbol: position.symbol,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    markPrice,
    quoteValue: marketValue,
    unrealizedPnl: pnl,
    unrealizedPnlPct:
      position.entryPrice > 0
        ? pnl / (position.entryPrice * position.quantity) * 100
        : 0,
    stopLossPrice: position.stopLossPrice,
    takeProfitPrice: position.takeProfitPrice,
    openedAt: position.openedAt.toISOString(),
    strategyName: position.strategyName,
  };
}

function serializeOrder(order: PaperOrder) {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: "market",
    quantity: order.quantity,
    price: order.price,
    fee: order.fee,
    status: order.status,
    strategyName: order.strategyName,
    createdAt: order.createdAt.toISOString(),
  };
}

function serializeTrade(trade: PaperTrade) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    grossPnl: trade.grossPnl,
    netPnl: trade.netPnl,
    fees: trade.fees,
    pnlPct: trade.pnlPct,
    exitReason: trade.exitReason,
    strategyName: trade.strategyName,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt.toISOString(),
  };
}

function serializeSignal(signal: TradingSignal) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    strategyName: signal.strategyName,
    side: signal.side,
    confidence: signal.confidence,
    price: signal.price,
    message: signal.message,
    riskApproved: signal.riskApproved,
    rejectionReason: signal.rejectionReason,
    createdAt: signal.createdAt.toISOString(),
  };
}

async function loadMarkedPositions(userId: string) {
  const open = await positions.list(userId);
  const adapter = getExchangeAdapter();
  const tickers = new Map<string, number>();
  for (const position of open) {
    if (!tickers.has(position.symbol)) {
      tickers.set(position.symbol, (await adapter.ticker(position.symbol)).price);
    }
  }
  return open.map((position) =>
    serializePosition(position, tickers.get(position.symbol) ?? position.entryPrice),
  );
}

async function aggregateTrades(userId: string, today: Date) {
  return trades.summarize(userId, today);
}

async function buildPortfolio(userId: string) {
  const { account } = await ensureUserAccount(userId);
  const positions = await loadMarkedPositions(userId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totals = await aggregateTrades(userId, today);
  const dayPnl =
    totals.realizedToday +
    positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  const markedValue = positions.reduce((sum, position) => sum + position.quoteValue, 0);
  return {
    mode: "paper",
    quoteCurrency: (positions[0]?.symbol.split("/")[1] ?? "USDT"),
    initialBalance: account.initialBalance,
    availableBalance: account.availableBalance,
    equity: account.availableBalance + markedValue,
    realizedPnl: totals.realizedPnl,
    unrealizedPnl,
    dayPnl,
    openPositions: positions,
  };
}

async function getRiskSettings(userId: string) {
  const { account } = await ensureUserAccount(userId);
  return {
    initialPaperBalance: account.initialBalance,
    availableBalance: account.availableBalance,
    riskPerTradePct: account.riskPerTradePct,
    maxDailyLossPct: account.maxDailyLossPct,
    maxPositionPct: account.maxPositionPct,
    maxExposurePct: account.maxExposurePct,
    maxDrawdownPct: account.maxDrawdownPct,
    maxOpenPositions: account.maxOpenPositions,
    maxTradesPerDay: account.maxTradesPerDay,
    feeBps: account.feeBps,
    slippageBps: account.slippageBps,
  };
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const { account } = await ensureUserAccount(userId);
  const [ticker, portfolio, recentOrders, recentTrades, recentSignals, strategy] = await Promise.all([
    getExchangeAdapter().ticker(process.env.TRADING_SYMBOL ?? "XRP/USDT"),
    buildPortfolio(userId),
    orders.list(userId, 6),
    trades.list(userId, 6),
    signals.list(userId, 6),
    account.activeStrategyId
      ? strategies.findOne(account.activeStrategyId, userId)
      : Promise.resolve(null),
  ]);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totals = await aggregateTrades(userId, today);
  const dashboard = {
    ticker,
    portfolio,
    trading: await getTradingStatus(userId),
    stats: {
      totalTrades: totals.totalTrades,
      winRate: totals.totalTrades ? totals.winningTrades / totals.totalTrades * 100 : 0,
      realizedPnl: totals.realizedPnl,
      feesPaid: totals.feesPaid,
      maxDrawdownPct: account.highWaterMark > 0
        ? Math.max(0, (account.highWaterMark - portfolio.equity) / account.highWaterMark * 100)
        : 0,
    },
    activeStrategy: serializeStrategy(strategy),
    recentTrades: recentTrades.map(serializeTrade),
    recentSignals: recentSignals.map(serializeSignal),
  };
  res.json(GetTradingDashboardResponse.parse(dashboard));
});

router.get("/portfolio", async (_req, res): Promise<void> => {
  const result = await buildPortfolio(authenticatedUserId(res));
  res.json(GetPortfolioResponse.parse(result));
});

router.get("/positions", async (_req, res): Promise<void> => {
  const result = await loadMarkedPositions(authenticatedUserId(res));
  res.json(GetPositionsResponse.parse(result));
});

router.get("/orders", async (req, res): Promise<void> => {
  const query = GetOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await orders.list(authenticatedUserId(res), query.data.limit);
  res.json(GetOrdersResponse.parse(rows.map(serializeOrder)));
});

router.get("/trades", async (req, res): Promise<void> => {
  const query = GetTradesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await trades.list(authenticatedUserId(res), query.data.limit);
  res.json(GetTradesResponse.parse(rows.map(serializeTrade)));
});

router.get("/signals", async (req, res): Promise<void> => {
  const query = GetSignalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await signals.list(authenticatedUserId(res), query.data.limit);
  res.json(GetSignalsResponse.parse(rows.map(serializeSignal)));
});

router.get("/trading/status", async (_req, res): Promise<void> => {
  const status = await getTradingStatus(authenticatedUserId(res));
  res.json(GetTradingStatusResponse.parse(status));
});

router.post("/trading/start", async (req, res): Promise<void> => {
  const body = StartPaperTradingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const status = await startPaperTrading(authenticatedUserId(res), body.data.strategyId);
    res.json(StartPaperTradingResponse.parse(status));
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Paper trading could not start.",
    });
  }
});

router.post("/trading/paper-buy", async (req, res): Promise<void> => {
  const spend = Number(req.body?.spend);
  if (!Number.isFinite(spend)) {
    res.status(400).json({ error: "Choose a paper spend in USDT." });
    return;
  }
  const result = await placePaperBuyForQuote(authenticatedUserId(res), spend, `quote:${spend}:${Date.now()}`);
  const message = typeof result === "string" ? result : result.message;
  if (!message.startsWith("Bought")) {
    res.status(409).json({ error: message });
    return;
  }
  res.json(typeof result === "string" ? { message } : result);
});

router.get("/trading/virtual-stake", async (_req, res): Promise<void> => {
  res.json(await readVirtualStake(authenticatedUserId(res)));
});

router.post("/trading/virtual-stake", async (req, res): Promise<void> => {
  const amount = Number(req.body?.virtualXrp);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    res.status(400).json({ error: "Choose a virtual stake from 0.01 to 1000000 XRP." });
    return;
  }
  res.json(await setVirtualStake(authenticatedUserId(res), amount));
});

router.post("/trading/paper-close", async (req, res): Promise<void> => {
  const message = await closeManualPaperPositions(authenticatedUserId(res), `desk:${Date.now()}`);
  if (!message.startsWith("Closed")) {
    res.status(409).json({ error: message });
    return;
  }
  const latest = (await trades.list(authenticatedUserId(res), 1))[0];
  res.json({
    message,
    settlement: latest ? { netPnl: latest.netPnl, exitPrice: latest.exitPrice, quantity: latest.quantity } : null,
  });
});

router.post("/trading/stop", async (_req, res): Promise<void> => {
  const status = await stopPaperTrading(authenticatedUserId(res));
  res.json(StopPaperTradingResponse.parse(status));
});

router.post("/trading/emergency-stop", async (_req, res): Promise<void> => {
  const status = await stopPaperTrading(authenticatedUserId(res), true);
  logger.error({ userId: authenticatedUserId(res) }, "Emergency stop activated");
  res.json(EmergencyStopTradingResponse.parse(status));
});

router.get("/risk/settings", async (_req, res): Promise<void> => {
  const result = await getRiskSettings(authenticatedUserId(res));
  res.json(GetRiskSettingsResponse.parse(result));
});

router.put("/risk/settings", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const body = UpdateRiskSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { account } = await ensureUserAccount(userId);
  if (account.state === "running") {
    res.status(409).json({ error: "Stop paper trading before changing risk limits." });
    return;
  }
  await accounts.update(userId, { ...body.data, updatedAt: new Date() });
  const updated = await getRiskSettings(userId);
  res.json(UpdateRiskSettingsResponse.parse(updated));
});

router.get("/paper-validation", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const { account } = await ensureUserAccount(userId);
  const checks: Array<{
    id: string;
    label: string;
    status: "passed" | "pending" | "blocked";
    detail: string;
  }> = [];
  try {
    const ticker = await getExchangeAdapter().ticker(
      process.env.TRADING_SYMBOL ?? "XRP/USDT",
    );
    checks.push({
      id: "market-feed",
      label: "Public market feed",
      status: ticker.stale ? "blocked" : "passed",
      detail: ticker.stale
        ? "The latest ticker is stale; automated paper execution will stop if data remains stale."
        : `${ticker.exchange} ticker is current (${ticker.symbol}).`,
    });
  } catch {
    checks.push({
      id: "market-feed",
      label: "Public market feed",
      status: "blocked",
      detail: "A current exchange ticker could not be verified.",
    });
  }
  try {
    await pingDatabase();
    checks.push({
      id: "database",
      label: "Persistent storage",
      status: "passed",
      detail: "Paper account, orders, positions and trades are stored in MongoDB.",
    });
  } catch {
    checks.push({
      id: "database",
      label: "Persistent storage",
      status: "blocked",
      detail: "Database health could not be verified.",
    });
  }
  checks.push({
    id: "risk-controls",
    label: "Risk limits",
    status: account.riskPerTradePct > 0 &&
        account.maxDailyLossPct > 0 &&
        account.maxPositionPct > 0 &&
        account.maxOpenPositions > 0
      ? "passed"
      : "blocked",
    detail: "Per-trade sizing, daily loss, position and drawdown limits are enforced before entries.",
  });
  checks.push({
    id: "execution-mode",
    label: "Execution mode",
    status: "passed",
    detail: "Paper mode only. Live exchange order execution is not implemented or enabled.",
  });
  checks.push({
    id: "recovery",
    label: "Restart recovery",
    status: "passed",
    detail: "Paper trading state and open positions persist in the database and are reloaded by the worker.",
  });
  checks.push({
    id: "exchange-reconciliation",
    label: "Exchange reconciliation",
    status: "pending",
    detail: "Not applicable to this paper-only build; no exchange account is connected.",
  });
  res.json(GetPaperValidationResponse.parse({
    checks,
    liveTradingEnabled: false,
  }));
});

export default router;