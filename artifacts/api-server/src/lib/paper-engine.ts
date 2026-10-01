import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  paperOrdersTable,
  paperPositionsTable,
  paperTradesTable,
  strategiesTable,
  tradingAccountsTable,
  tradingSignalsTable,
} from "@workspace/db";
import { evaluateSignal, type Strategy as MathStrategy } from "./trading-math";
import { getExchangeAdapter } from "./market-data";
import { logger } from "./logger";
import { ensureUserAccount } from "./trading-store";

const ENGINE_INTERVAL_MS = 15_000;
const lockedUsers = new Set<string>();
let engineTimer: ReturnType<typeof setInterval> | undefined;

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const roundQuantity = (value: number): number =>
  Math.floor(value * 1e6) / 1e6;
const utcDayStart = (): Date => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const deterministicId = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function asMathStrategy(strategy: typeof strategiesTable.$inferSelect): MathStrategy {
  return {
    type: strategy.type as MathStrategy["type"],
    params: strategy.params,
    stopLossPct: strategy.stopLossPct,
    takeProfitPct: strategy.takeProfitPct,
    trailingStopPct: strategy.trailingStopPct,
    minConfidence: strategy.minConfidence,
  };
}

function reject(reason: string): { allowed: false; reason: string } {
  return { allowed: false, reason };
}

async function assessEntry(
  userId: string,
  strategy: typeof strategiesTable.$inferSelect,
  price: number,
  signalConfidence: number,
) {
  const [account] = await db
    .select()
    .from(tradingAccountsTable)
    .where(eq(tradingAccountsTable.userId, userId))
    .limit(1);
  if (!account) return reject("Paper account is unavailable.");
  if (account.state !== "running" || account.emergencyStop) {
    return reject("Trading is stopped or halted.");
  }
  if (!Number.isFinite(price) || price <= 0) return reject("Market price is invalid.");
  if (signalConfidence < strategy.minConfidence) {
    return reject("Signal confidence is below the configured minimum.");
  }
  if (strategy.stopLossPct <= 0 || strategy.takeProfitPct <= 0) {
    return reject("A valid stop-loss and take-profit are required.");
  }

  const openPositions = await db
    .select()
    .from(paperPositionsTable)
    .where(eq(paperPositionsTable.userId, userId));
  if (openPositions.length >= account.maxOpenPositions) {
    return reject("Maximum open-position count reached.");
  }
  const today = utcDayStart();
  const todayEntries = await db
    .select()
    .from(paperOrdersTable)
    .where(
      and(
        eq(paperOrdersTable.userId, userId),
        eq(paperOrdersTable.side, "buy"),
        gte(paperOrdersTable.createdAt, today),
      ),
    );
  if (todayEntries.length >= account.maxTradesPerDay ||
      todayEntries.length >= strategy.maxTradesPerDay) {
    return reject("Maximum daily order count reached.");
  }

  const [lastOrder] = await db
    .select()
    .from(paperOrdersTable)
    .where(eq(paperOrdersTable.userId, userId))
    .orderBy(desc(paperOrdersTable.createdAt))
    .limit(1);
  if (
    lastOrder &&
    Date.now() - lastOrder.createdAt.getTime() < strategy.cooldownSeconds * 1000
  ) {
    return reject("Strategy cooldown is still active.");
  }

  const closedToday = await db
    .select({ netPnl: paperTradesTable.netPnl })
    .from(paperTradesTable)
    .where(
      and(
        eq(paperTradesTable.userId, userId),
        gte(paperTradesTable.closedAt, today),
      ),
    );
  const realizedToday = closedToday.reduce((sum, trade) => sum + trade.netPnl, 0);
  const dailyLossPct =
    account.dayStartBalance > 0
      ? Math.max(0, -realizedToday / account.dayStartBalance * 100)
      : 100;
  if (dailyLossPct >= Math.min(account.maxDailyLossPct, strategy.maxDailyLossPct)) {
    return reject("Maximum daily loss limit reached.");
  }

  const adapter = getExchangeAdapter();
  const openMarks = await Promise.all(
    openPositions.map(async (position) =>
      position.symbol === strategy.symbol
        ? price
        : (await adapter.ticker(position.symbol)).price,
    ),
  );
  const openNotional = openPositions.reduce(
    (sum, position, index) => sum + position.quantity * openMarks[index],
    0,
  );
  const equity = Math.max(0, account.availableBalance + openNotional);
  const drawdownPct =
    account.highWaterMark > 0
      ? Math.max(0, (account.highWaterMark - equity) / account.highWaterMark * 100)
      : 100;
  if (drawdownPct >= account.maxDrawdownPct) {
    return reject("Maximum portfolio drawdown reached.");
  }
  const maxPositionPct = Math.min(account.maxPositionPct, strategy.maxPositionPct);
  const riskAmount = equity * account.riskPerTradePct / 100;
  const stopDistance = price * strategy.stopLossPct / 100;
  const rawRiskQuantity = riskAmount / stopDistance;
  const positionCap = equity * maxPositionPct / 100;
  const exposureCap = Math.max(0, equity * account.maxExposurePct / 100 - openNotional);
  const feeRate = account.feeBps / 10_000;
  const availableNotional = account.availableBalance / (1 + feeRate);
  const notional = Math.min(positionCap, exposureCap, availableNotional, rawRiskQuantity * price);
  const quantity = roundQuantity(notional / price);
  if (quantity <= 0 || quantity * price < 5) {
    return reject("Calculated order is below the paper exchange's minimum size.");
  }
  const fee = roundMoney(quantity * price * feeRate);
  if (quantity * price + fee > account.availableBalance) {
    return reject("Available paper balance is insufficient.");
  }
  return {
    allowed: true as const,
    quantity,
    fee,
    stopLossPrice: roundMoney(price * (1 - strategy.stopLossPct / 100)),
    takeProfitPrice: roundMoney(price * (1 + strategy.takeProfitPct / 100)),
    equity,
    feeBps: account.feeBps,
    slippageBps: account.slippageBps,
  };
}

async function openPaperPosition(
  userId: string,
  strategy: typeof strategiesTable.$inferSelect,
  signalKey: string,
  price: number,
  confidence: number,
): Promise<string | null> {
  const decision = await assessEntry(userId, strategy, price, confidence);
  if (!decision.allowed) return decision.reason;

  const fillPrice = roundMoney(price * (1 + decision.slippageBps / 10_000));
  const fillFee = roundMoney(decision.quantity * fillPrice * decision.feeBps / 10_000);
  if (decision.quantity * fillPrice + fillFee > (await db
    .select({ availableBalance: tradingAccountsTable.availableBalance })
    .from(tradingAccountsTable)
    .where(eq(tradingAccountsTable.userId, userId))
    .limit(1))[0]!.availableBalance) {
    return "Slippage and fees exceed available paper balance.";
  }

  try {
    await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(tradingAccountsTable)
        .where(eq(tradingAccountsTable.userId, userId))
        .limit(1);
      if (!account || account.state !== "running" || account.emergencyStop) {
        throw new Error("Trading stopped before the order could be filled.");
      }
      const clientOrderId = deterministicId(`buy:${signalKey}`);
      await tx.insert(paperOrdersTable).values({
        userId,
        clientOrderId,
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.symbol,
        side: "buy",
        quantity: decision.quantity,
        price: fillPrice,
        fee: fillFee,
        status: "filled",
      });
      await tx.insert(paperPositionsTable).values({
        userId,
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.symbol,
        quantity: decision.quantity,
        entryPrice: fillPrice,
        stopLossPrice: roundMoney(fillPrice * (1 - strategy.stopLossPct / 100)),
        takeProfitPrice: roundMoney(fillPrice * (1 + strategy.takeProfitPct / 100)),
        highestPrice: fillPrice,
        entryFee: fillFee,
      });
      const newBalance = roundMoney(
        account.availableBalance - decision.quantity * fillPrice - fillFee,
      );
      await tx
        .update(tradingAccountsTable)
        .set({ availableBalance: newBalance, updatedAt: new Date() })
        .where(eq(tradingAccountsTable.userId, userId));
    });
    return null;
  } catch (error) {
    logger.warn({ err: error, userId, strategyId: strategy.id }, "Paper buy was not filled");
    return error instanceof Error ? error.message : "Paper order failed safely.";
  }
}

async function closePaperPosition(
  userId: string,
  position: typeof paperPositionsTable.$inferSelect,
  price: number,
  reason: string,
): Promise<void> {
  if (!Number.isFinite(price) || price <= 0 || position.quantity <= 0) {
    throw new Error("Invalid position or price; closing order was not created.");
  }
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(paperPositionsTable)
      .where(
        and(
          eq(paperPositionsTable.userId, userId),
          eq(paperPositionsTable.id, position.id),
        ),
      )
      .limit(1);
    if (!current) return;

    const [account] = await tx
      .select()
      .from(tradingAccountsTable)
      .where(eq(tradingAccountsTable.userId, userId))
      .limit(1);
    if (!account || account.state !== "running" || account.emergencyStop) return;

    const exitPrice = roundMoney(price * (1 - account.slippageBps / 10_000));
    const exitFee = roundMoney(position.quantity * exitPrice * account.feeBps / 10_000);
    const grossPnl = roundMoney((exitPrice - position.entryPrice) * position.quantity);
    const netPnl = roundMoney(grossPnl - position.entryFee - exitFee);
    const closedAt = new Date();
    const clientOrderId = deterministicId(`sell:${position.id}:${reason}`);

    await tx.insert(paperOrdersTable).values({
      userId,
      clientOrderId,
      strategyId: position.strategyId,
      strategyName: position.strategyName,
      symbol: position.symbol,
      side: "sell",
      quantity: position.quantity,
      price: exitPrice,
      fee: exitFee,
      status: "filled",
    }).onConflictDoNothing();
    await tx.insert(paperTradesTable).values({
      userId,
      strategyId: position.strategyId,
      strategyName: position.strategyName,
      symbol: position.symbol,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice,
      grossPnl,
      netPnl,
      fees: roundMoney(position.entryFee + exitFee),
      pnlPct: position.entryPrice > 0 ? roundMoney(netPnl / (position.entryPrice * position.quantity) * 100) : 0,
      exitReason: reason,
      openedAt: position.openedAt,
      closedAt,
    });
    await tx
      .update(tradingAccountsTable)
      .set({
        availableBalance: roundMoney(
          account.availableBalance + position.quantity * exitPrice - exitFee,
        ),
        updatedAt: closedAt,
      })
      .where(eq(tradingAccountsTable.userId, userId));
    await tx
      .delete(paperPositionsTable)
      .where(
        and(
          eq(paperPositionsTable.userId, userId),
          eq(paperPositionsTable.id, position.id),
        ),
      );
  });
}

async function haltForDataFailure(userId: string, message: string) {
  await db
    .update(tradingAccountsTable)
    .set({ state: "halted", emergencyStop: true, updatedAt: new Date() })
    .where(eq(tradingAccountsTable.userId, userId));
  logger.error({ userId, message }, "Paper engine halted due to market-data failure");
}

async function runUserCycle(userId: string): Promise<void> {
  if (lockedUsers.has(userId)) return;
  lockedUsers.add(userId);
  try {
    const { account } = await ensureUserAccount(userId);
    if (account.state !== "running" || account.emergencyStop || !account.activeStrategyId) return;

    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(
        and(
          eq(strategiesTable.id, account.activeStrategyId),
          eq(strategiesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!strategy) {
      await haltForDataFailure(userId, "Active strategy disappeared.");
      return;
    }
    const exchange = getExchangeAdapter();
    const [ticker, candles] = await Promise.all([
      exchange.ticker(strategy.symbol),
      exchange.candles(strategy.symbol, strategy.interval, 240),
    ]);
    if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
      await haltForDataFailure(userId, "Market ticker is stale.");
      return;
    }
    await db
      .update(tradingAccountsTable)
      .set({ lastMarketUpdate: new Date(ticker.updatedAt), updatedAt: new Date() })
      .where(eq(tradingAccountsTable.userId, userId));
    if (candles.length < Math.max(strategy.params.slowEma, strategy.params.bollingerPeriod) + 5) {
      return;
    }

    const open = await db
      .select()
      .from(paperPositionsTable)
      .where(eq(paperPositionsTable.userId, userId));
    const today = utcDayStart();
    if (account.dayStartedAt < today) {
      const openingEquity = account.availableBalance + open.reduce(
        (sum, position) =>
          sum + position.quantity *
            (position.symbol === strategy.symbol ? ticker.price : position.entryPrice),
        0,
      );
      await db
        .update(tradingAccountsTable)
        .set({
          dayStartBalance: openingEquity,
          dayStartedAt: today,
          updatedAt: new Date(),
        })
        .where(eq(tradingAccountsTable.userId, userId));
    }
    for (const position of open) {
      const high = Math.max(position.highestPrice, ticker.price);
      const trailingStop =
        strategy.trailingStopPct !== null && strategy.trailingStopPct > 0
          ? high * (1 - strategy.trailingStopPct / 100)
          : position.stopLossPrice;
      const stop = Math.max(position.stopLossPrice, trailingStop);
      await db
        .update(paperPositionsTable)
        .set({ highestPrice: high, stopLossPrice: stop })
        .where(eq(paperPositionsTable.id, position.id));
      if (ticker.price <= stop) {
        await closePaperPosition(
          userId,
          { ...position, highestPrice: high, stopLossPrice: stop },
          stop,
          trailingStop > position.stopLossPrice ? "trailing_stop" : "stop_loss",
        );
      } else if (ticker.price >= position.takeProfitPrice) {
        await closePaperPosition(userId, position, position.takeProfitPrice, "take_profit");
      }
    }

    const [latestAccount] = await db
      .select()
      .from(tradingAccountsTable)
      .where(eq(tradingAccountsTable.userId, userId))
      .limit(1);
    if (!latestAccount || latestAccount.state !== "running" || latestAccount.emergencyStop) return;
    const remainingBeforeSignal = await db
      .select()
      .from(paperPositionsTable)
      .where(eq(paperPositionsTable.userId, userId));
    const closedToday = await db
      .select({ netPnl: paperTradesTable.netPnl })
      .from(paperTradesTable)
      .where(
        and(
          eq(paperTradesTable.userId, userId),
          gte(paperTradesTable.closedAt, today),
        ),
      );
    const dayPnl =
      closedToday.reduce((sum, trade) => sum + trade.netPnl, 0) +
      remainingBeforeSignal.reduce(
        (sum, position) =>
          sum + (ticker.price - position.entryPrice) * position.quantity - position.entryFee,
        0,
      );
    const dailyLossPct = latestAccount.dayStartBalance > 0
      ? Math.max(0, -dayPnl / latestAccount.dayStartBalance * 100)
      : 100;
    if (dailyLossPct >= Math.min(latestAccount.maxDailyLossPct, strategy.maxDailyLossPct)) {
      await db
        .update(tradingAccountsTable)
        .set({ state: "halted", emergencyStop: true, updatedAt: new Date() })
        .where(eq(tradingAccountsTable.userId, userId));
      logger.warn({ userId, dailyLossPct }, "Paper engine halted at daily loss limit");
      return;
    }

    const latest = candles[candles.length - 1];
    const signal = evaluateSignal(candles, asMathStrategy(strategy));
    const signalKey = `${strategy.id}:${latest.time}`;
    const risk = signal.side === "buy"
      ? await assessEntry(userId, strategy, ticker.price, signal.confidence)
      : { allowed: true as const };
    const rejectionReason = risk.allowed ? null : risk.reason;
    const [savedSignal] = await db
      .insert(tradingSignalsTable)
      .values({
        userId,
        signalKey,
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.symbol,
        side: signal.side,
        confidence: signal.confidence,
        price: ticker.price,
        message: signal.message,
        riskApproved: risk.allowed,
        rejectionReason,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!savedSignal) return;

    if (signal.side === "buy" && risk.allowed) {
      const failure = await openPaperPosition(
        userId,
        strategy,
        signalKey,
        ticker.price,
        signal.confidence,
      );
      if (failure) {
        await db
          .update(tradingSignalsTable)
          .set({ riskApproved: false, rejectionReason: failure })
          .where(eq(tradingSignalsTable.id, savedSignal.id));
      }
    } else if (signal.side === "sell") {
      const position = open.find((item) => item.symbol === strategy.symbol);
      if (position) {
        await closePaperPosition(userId, position, ticker.price, "strategy_exit");
      }
    }

    const remaining = await db
      .select()
      .from(paperPositionsTable)
      .where(eq(paperPositionsTable.userId, userId));
    const openNotional = remaining.reduce(
      (sum, position) => sum + position.quantity * (position.symbol === strategy.symbol ? ticker.price : position.entryPrice),
      0,
    );
    const [currentAccount] = await db
      .select()
      .from(tradingAccountsTable)
      .where(eq(tradingAccountsTable.userId, userId))
      .limit(1);
    if (!currentAccount) return;
    const equity = currentAccount.availableBalance + openNotional;
    const highWaterMark = Math.max(currentAccount.highWaterMark, equity);
    const drawdown = highWaterMark > 0 ? (highWaterMark - equity) / highWaterMark * 100 : 0;
    if (drawdown >= account.maxDrawdownPct) {
      await db
        .update(tradingAccountsTable)
        .set({ highWaterMark, state: "halted", emergencyStop: true, updatedAt: new Date() })
        .where(eq(tradingAccountsTable.userId, userId));
      logger.warn({ userId, drawdown }, "Paper engine halted at max drawdown");
    } else {
      await db
        .update(tradingAccountsTable)
        .set({ highWaterMark, updatedAt: new Date() })
        .where(eq(tradingAccountsTable.userId, userId));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown paper engine failure";
    await haltForDataFailure(userId, message);
  } finally {
    lockedUsers.delete(userId);
  }
}

export async function startPaperTrading(userId: string, strategyId: string) {
  const { account } = await ensureUserAccount(userId);
  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(
      and(
        eq(strategiesTable.id, strategyId),
        eq(strategiesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!strategy) throw new Error("Strategy not found.");
  const exchange = getExchangeAdapter();
  const [ticker, candles] = await Promise.all([
    exchange.ticker(strategy.symbol),
    exchange.candles(strategy.symbol, strategy.interval, 240),
  ]);
  if (ticker.stale) throw new Error("Market data is stale; paper trading was not started.");
  if (candles.length < Math.max(strategy.params.slowEma, strategy.params.bollingerPeriod) + 5) {
    throw new Error("Not enough complete candles to initialize this strategy.");
  }
  if (account.availableBalance <= 0) {
    throw new Error("Paper balance is exhausted; trading was not started.");
  }
  const positions = await db
    .select()
    .from(paperPositionsTable)
    .where(eq(paperPositionsTable.userId, userId));
  const equity = account.availableBalance + positions.reduce(
    (sum, position) =>
      sum + position.quantity *
        (position.symbol === strategy.symbol ? ticker.price : position.entryPrice),
    0,
  );
  const drawdownPct = account.highWaterMark > 0
    ? Math.max(0, (account.highWaterMark - equity) / account.highWaterMark * 100)
    : 100;
  if (drawdownPct >= account.maxDrawdownPct) {
    throw new Error("Portfolio drawdown is at the configured limit.");
  }
  const closedToday = await db
    .select()
    .from(paperTradesTable)
    .where(
      and(
        eq(paperTradesTable.userId, userId),
        gte(paperTradesTable.closedAt, utcDayStart()),
      ),
    );
  const realizedToday = closedToday.reduce((sum, trade) => sum + trade.netPnl, 0);
  const dayStartBalance = account.dayStartedAt < utcDayStart()
    ? equity
    : account.dayStartBalance;
  if (
    dayStartBalance > 0 &&
    -realizedToday / dayStartBalance * 100 >= account.maxDailyLossPct
  ) {
    throw new Error("Daily loss limit is reached; paper trading was not started.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(strategiesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(strategiesTable.userId, userId));
    await tx
      .update(strategiesTable)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(strategiesTable.id, strategy.id));
    await tx
      .update(tradingAccountsTable)
      .set({
        state: "running",
        emergencyStop: false,
        activeStrategyId: strategy.id,
        lastMarketUpdate: new Date(ticker.updatedAt),
        dayStartBalance,
        dayStartedAt: account.dayStartedAt < utcDayStart() ? utcDayStart() : account.dayStartedAt,
        updatedAt: new Date(),
      })
      .where(eq(tradingAccountsTable.userId, userId));
  });
  return getTradingStatus(userId);
}

export async function stopPaperTrading(userId: string, emergency = false) {
  await ensureUserAccount(userId);
  await db
    .update(tradingAccountsTable)
    .set({
      state: emergency ? "halted" : "stopped",
      emergencyStop: emergency,
      updatedAt: new Date(),
    })
    .where(eq(tradingAccountsTable.userId, userId));
  return getTradingStatus(userId);
}

export async function getTradingStatus(userId: string) {
  const { account } = await ensureUserAccount(userId);
  const [strategy] = account.activeStrategyId
    ? await db
        .select({ id: strategiesTable.id })
        .from(strategiesTable)
        .where(
          and(
            eq(strategiesTable.id, account.activeStrategyId),
            eq(strategiesTable.userId, userId),
          ),
        )
        .limit(1)
    : [];
  return {
    mode: "paper",
    state: account.state,
    emergencyStop: account.emergencyStop,
    activeStrategyId: strategy?.id ?? null,
    liveTradingEnabled: false,
    lastMarketUpdate: account.lastMarketUpdate?.toISOString() ?? null,
    message: account.state === "halted"
      ? "Trading is halted. Open positions are preserved; no new orders will be created."
      : account.state === "running"
        ? "Paper trading is running. Live orders are disabled."
        : "Paper trading is stopped. Live orders are disabled.",
  };
}

export function startPaperEngine(): void {
  if (engineTimer) return;
  const cycle = async () => {
    try {
      const active = await db
        .select({ userId: tradingAccountsTable.userId })
        .from(tradingAccountsTable)
        .where(
          and(
            eq(tradingAccountsTable.state, "running"),
            eq(tradingAccountsTable.emergencyStop, false),
          ),
        )
        .limit(100);
      for (const account of active) {
        void runUserCycle(account.userId);
      }
    } catch (error) {
      logger.error({ err: error }, "Paper engine scheduler could not read accounts");
    }
  };
  engineTimer = setInterval(() => void cycle(), ENGINE_INTERVAL_MS);
  engineTimer.unref?.();
  void cycle();
  logger.info({ intervalMs: ENGINE_INTERVAL_MS }, "Paper trading engine initialized");
}