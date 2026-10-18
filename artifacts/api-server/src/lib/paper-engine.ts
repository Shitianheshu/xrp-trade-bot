import { createHash } from "node:crypto";
import {
  accounts,
  orders,
  positions,
  signals,
  strategies,
  telegramAlarms,
  telegramLinks,
  trades,
  type PaperPosition,
  type StrategyRecord,
} from "@workspace/db";
import { escapeHtml, sendTelegramMessage, telegramAlarmText } from "./telegram";
import { evaluateSignal, type Strategy as MathStrategy } from "./trading-math";
import { getExchangeAdapter } from "./market-data";
import { logger } from "./logger";
import { ensureUserAccount } from "./trading-store";

const ENGINE_INTERVAL_MS = 15_000;
const lockedUsers = new Set<string>();
let engineTimer: ReturnType<typeof setInterval> | undefined;

const DEFAULT_VIRTUAL_XRP = 200;
const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1e8) / 1e8;

function stakeOf(account: { virtualXrp?: number; virtualDeployed?: number }) {
  const virtualXrp = account.virtualXrp != null && Number.isFinite(account.virtualXrp) && account.virtualXrp > 0
    ? account.virtualXrp
    : DEFAULT_VIRTUAL_XRP;
  const virtualDeployed = account.virtualDeployed != null && Number.isFinite(account.virtualDeployed) && account.virtualDeployed > 0
    ? account.virtualDeployed
    : 0;
  return { virtualXrp, virtualDeployed };
}

export async function readVirtualStake(userId: string): Promise<{ virtualXrp: number; deployedXrp: number }> {
  const { account } = await ensureUserAccount(userId);
  const stake = stakeOf(account);
  if (account.virtualXrp == null) {
    await accounts.update(userId, { virtualXrp: stake.virtualXrp, virtualDeployed: stake.virtualDeployed, updatedAt: new Date() });
  }
  return { virtualXrp: stake.virtualXrp, deployedXrp: stake.virtualDeployed };
}

export async function setVirtualStake(userId: string, virtualXrp: number): Promise<{ virtualXrp: number; deployedXrp: number }> {
  const { account } = await ensureUserAccount(userId);
  const next = roundMoney(Math.max(0.01, Math.min(virtualXrp, 1_000_000)));
  const deployed = stakeOf(account).virtualDeployed;
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  return { virtualXrp: next, deployedXrp: deployed };
}
const roundQuantity = (value: number): number =>
  Math.floor(value * 1e6) / 1e6;
const utcDayStart = (): Date => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const deterministicId = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function freshPositionPrice(
  symbol: string,
  preferredSymbol: string,
  preferredPrice: number,
  adapter = getExchangeAdapter(),
): Promise<number> {
  if (symbol === preferredSymbol) return preferredPrice;
  const ticker = await adapter.ticker(symbol);
  if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
    throw new Error(`Market data for open position ${symbol} is stale.`);
  }
  return ticker.price;
}

function asMathStrategy(strategy: StrategyRecord): MathStrategy {
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
  strategy: StrategyRecord,
  price: number,
  signalConfidence: number,
) {
  const account = await accounts.findByUser(userId);
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

  const openPositions = await positions.list(userId);
  if (openPositions.length >= account.maxOpenPositions) {
    return reject("Maximum open-position count reached.");
  }
  const today = utcDayStart();
  const todayEntries = await orders.countBuysSince(userId, today);
  const todayStrategyEntries = await orders.countBuysSince(userId, today, strategy.id);
  if (todayEntries >= account.maxTradesPerDay ||
      todayStrategyEntries >= strategy.maxTradesPerDay) {
    return reject("Maximum daily order count reached.");
  }

  const lastOrder = await orders.latestForStrategy(userId, strategy.id);
  if (
    lastOrder &&
    Date.now() - lastOrder.createdAt.getTime() < strategy.cooldownSeconds * 1000
  ) {
    return reject("Strategy cooldown is still active.");
  }

  const closedToday = await trades.since(userId, today);
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
      freshPositionPrice(position.symbol, strategy.symbol, price, adapter),
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
  strategy: StrategyRecord,
  signalKey: string,
  price: number,
  confidence: number,
): Promise<string | null> {
  const decision = await assessEntry(userId, strategy, price, confidence);
  if (!decision.allowed) return decision.reason;

  const fillPrice = roundMoney(price * (1 + decision.slippageBps / 10_000));
  const fillFee = roundMoney(decision.quantity * fillPrice * decision.feeBps / 10_000);
  const balanceRow = await accounts.findByUser(userId);
  if (decision.quantity * fillPrice + fillFee > (balanceRow?.availableBalance ?? 0)) {
    return "Slippage and fees exceed available paper balance.";
  }

  try {
    const account = await accounts.findByUser(userId);
    if (!account || account.state !== "running" || account.emergencyStop) {
      throw new Error("Trading stopped before the order could be filled.");
    }
    const clientOrderId = deterministicId(`buy:${signalKey}`);
    await orders.insert({
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
    await positions.insert({
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
    const stake = stakeOf(account);
    const used = Math.min(decision.quantity, stake.virtualXrp);
    await accounts.update(userId, {
      availableBalance: newBalance,
      virtualXrp: roundMoney(Math.max(0.01, stake.virtualXrp - used)),
      virtualDeployed: used,
      updatedAt: new Date(),
    });
    return null;
  } catch (error) {
    logger.warn({ err: error, userId, strategyId: strategy.id }, "Paper buy was not filled");
    return error instanceof Error ? error.message : "Paper order failed safely.";
  }
}

async function closePaperPosition(
  userId: string,
  position: PaperPosition,
  price: number,
  reason: string,
  options?: { requireRunning?: boolean; clientOrderId?: string },
): Promise<void> {
  if (!Number.isFinite(price) || price <= 0 || position.quantity <= 0) {
    throw new Error("Invalid position or price; closing order was not created.");
  }
  const current = await positions.findOne(userId, position.id);
  if (!current) return;

  const account = await accounts.findByUser(userId);
  const requireRunning = options?.requireRunning !== false;
  if (!account || (requireRunning && (account.state !== "running" || account.emergencyStop))) return;

  const exitPrice = roundMoney(price * (1 - account.slippageBps / 10_000));
  const exitFee = roundMoney(position.quantity * exitPrice * account.feeBps / 10_000);
  const grossPnl = roundMoney((exitPrice - position.entryPrice) * position.quantity);
  const netPnl = roundMoney(grossPnl - position.entryFee - exitFee);
  const closedAt = new Date();
  const clientOrderId = options?.clientOrderId ?? deterministicId(`sell:${position.id}:${reason}`);

  const savedOrder = await orders.insertIgnore({
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
  });
  if (!savedOrder) return;
  await trades.insert({
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
  const stake = stakeOf(account);
  const pnlXrp = exitPrice > 0 ? netPnl / exitPrice : 0;
  const nextStake = roundMoney(Math.max(0.01, stake.virtualXrp + stake.virtualDeployed + pnlXrp));
  await accounts.update(userId, {
    availableBalance: roundMoney(
      account.availableBalance + position.quantity * exitPrice - exitFee,
    ),
    virtualXrp: nextStake,
    virtualDeployed: 0,
    updatedAt: closedAt,
  });
  await positions.remove(userId, position.id);
  await telegramAlarms.release(userId, `above-entry:${position.id}`);
}

async function haltForDataFailure(userId: string, message: string) {
  await accounts.update(userId, { state: "halted", emergencyStop: true, updatedAt: new Date() });
  logger.error({ userId, message }, "Paper engine halted due to market-data failure");
}

async function tellDesk(userId: string, text: string): Promise<boolean> {
  try {
    const link = await telegramLinks.find(userId);
    if (!link?.enabled || !link.botToken || !link.chatId) return false;
    await sendTelegramMessage(link.botToken, link.chatId, text);
    return true;
  } catch (error) {
    logger.warn({ err: error, userId }, "Telegram fill notice was not sent");
    return false;
  }
}

async function announceFills(userId: string, before: PaperPosition[]): Promise<boolean> {
  const after = await positions.list(userId);
  const beforeIds = new Set(before.map(position => position.id));
  const afterIds = new Set(after.map(position => position.id));
  const opened = after.filter(position => !beforeIds.has(position.id));
  const closed = before.filter(position => !afterIds.has(position.id));
  if (!opened.length && !closed.length) return false;
  const account = await accounts.findByUser(userId);
  const stake = account ? stakeOf(account).virtualXrp : DEFAULT_VIRTUAL_XRP;
  const lines = [
    ...opened.map(position => `<b>Bought</b> ${position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${escapeHtml(position.symbol)} at ${position.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}.`),
    ...closed.map(position => `<b>Sold</b> ${position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${escapeHtml(position.symbol)}.`),
    `Virtual stake ${stake.toFixed(2)} XRP. The desk shows the same position.`,
  ];
  return tellDesk(userId, lines.join("\n"));
}

async function watchAboveEntry(): Promise<void> {
  const links = await telegramLinks.listEnabled();
  const exchange = getExchangeAdapter();
  for (const link of links) {
    const open = await positions.list(link.userId);
    for (const position of open) {
      const key = `above-entry:${position.id}`;
      let ticker;
      try {
        ticker = await exchange.ticker(position.symbol);
      } catch (error) {
        logger.warn({ err: error, userId: link.userId, symbol: position.symbol }, "Buy-price alert skipped");
        continue;
      }
      if (!Number.isFinite(ticker.price) || ticker.price <= 0 || ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
        continue;
      }
      if (ticker.price <= position.entryPrice) {
        await telegramAlarms.release(link.userId, key);
        continue;
      }
      const claimed = await telegramAlarms.claim(link.userId, key);
      if (!claimed) continue;
      const move = ticker.price - position.entryPrice;
      const unrealized = move * position.quantity - position.entryFee;
      const quote = position.symbol.split("/")[1] ?? "USDT";
      const price = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
      const sent = await tellDesk(link.userId, telegramAlarmText(
        "Above your buy",
        [
          `${position.symbol} ${price(ticker.price)} is above your buy ${price(position.entryPrice)}.`,
          `Up ${price(move)} · open ${position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} · unrealized ${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)} ${quote}.`,
          "Close position in Manual trade when you want to take it.",
        ].join("\n"),
      ));
      if (!sent) await telegramAlarms.release(link.userId, key);
    }
  }
}

async function runUserCycle(userId: string, notify = true): Promise<void> {
  if (lockedUsers.has(userId)) return;
  lockedUsers.add(userId);
  let before: PaperPosition[] = [];
  let sawBook = false;
  let candleNote: string | null = null;
  try {
    before = await positions.list(userId);
    sawBook = true;
    const { account } = await ensureUserAccount(userId);
    if (account.state !== "running" || account.emergencyStop || !account.activeStrategyId) return;

    const strategy = await strategies.findOne(account.activeStrategyId, userId);
    if (!strategy) {
      await haltForDataFailure(userId, "Active strategy disappeared.");
      return;
    }
    const exchange = getExchangeAdapter();
    const [ticker, candleRows] = await Promise.all([
      exchange.ticker(strategy.symbol),
      exchange.candles(strategy.symbol, strategy.interval, 240),
    ]);
    if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
      await haltForDataFailure(userId, "Market ticker is stale.");
      return;
    }
    await accounts.update(userId, { lastMarketUpdate: new Date(ticker.updatedAt), updatedAt: new Date() });
    if (candleRows.length < Math.max(strategy.params.slowEma, strategy.params.bollingerPeriod) + 5) {
      return;
    }

    const open = await positions.list(userId);
    const today = utcDayStart();
    if (account.dayStartedAt < today) {
      const openingEquity = account.availableBalance + open.reduce(
        (sum, position) =>
          sum + position.quantity *
            (position.symbol === strategy.symbol ? ticker.price : position.entryPrice),
        0,
      );
      await accounts.update(userId, {
        dayStartBalance: openingEquity,
        dayStartedAt: today,
        updatedAt: new Date(),
      });
    }
    for (const position of open) {
      if (position.strategyId !== strategy.id) continue;
      const positionPrice = await freshPositionPrice(
        position.symbol,
        strategy.symbol,
        ticker.price,
        exchange,
      );
      const high = Math.max(position.highestPrice, positionPrice);
      const trailingStop =
        strategy.trailingStopPct !== null && strategy.trailingStopPct > 0
          ? high * (1 - strategy.trailingStopPct / 100)
          : position.stopLossPrice;
      const stop = Math.max(position.stopLossPrice, trailingStop);
      await positions.update(position.id, { highestPrice: high, stopLossPrice: stop });
      if (stop > 0 && positionPrice <= stop) {
        await closePaperPosition(
          userId,
          { ...position, highestPrice: high, stopLossPrice: stop },
          Math.min(positionPrice, stop),
          trailingStop > position.stopLossPrice ? "trailing_stop" : "stop_loss",
        );
      } else if (position.takeProfitPrice > 0 && positionPrice >= position.takeProfitPrice) {
        await closePaperPosition(userId, position, position.takeProfitPrice, "take_profit");
      }
    }

    const latestAccount = await accounts.findByUser(userId);
    if (!latestAccount || latestAccount.state !== "running" || latestAccount.emergencyStop) return;
    const remainingBeforeSignal = await positions.list(userId);
    const closedToday = await trades.since(userId, today);
    const unrealizedToday = await Promise.all(remainingBeforeSignal.map(async (position) => {
      const mark = await freshPositionPrice(
        position.symbol,
        strategy.symbol,
        ticker.price,
        exchange,
      );
      return (mark - position.entryPrice) * position.quantity - position.entryFee;
    }));
    const dayPnl =
      closedToday.reduce((sum, trade) => sum + trade.netPnl, 0) +
      unrealizedToday.reduce((sum, pnl) => sum + pnl, 0);
    const dailyLossPct = latestAccount.dayStartBalance > 0
      ? Math.max(0, -dayPnl / latestAccount.dayStartBalance * 100)
      : 100;
    if (dailyLossPct >= Math.min(latestAccount.maxDailyLossPct, strategy.maxDailyLossPct)) {
      await accounts.update(userId, { state: "halted", emergencyStop: true, updatedAt: new Date() });
      logger.warn({ userId, dailyLossPct }, "Paper engine halted at daily loss limit");
      return;
    }

    const latest = candleRows[candleRows.length - 1];
    const signal = evaluateSignal(candleRows, asMathStrategy(strategy));
    const signalKey = `${strategy.id}:${latest.time}`;
    const risk = signal.side === "buy"
      ? await assessEntry(userId, strategy, ticker.price, signal.confidence)
      : { allowed: true as const };
    const rejectionReason = risk.allowed ? null : risk.reason;
    const savedSignal = await signals.insertIgnore({
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
    });

    if (signal.side === "buy" && risk.allowed) {
      const owns = remainingBeforeSignal.some((item) => item.strategyId === strategy.id && item.symbol === strategy.symbol);
      if (!owns) {
        const failure = await openPaperPosition(
          userId,
          strategy,
          signalKey,
          ticker.price,
          signal.confidence,
        );
        if (failure && savedSignal) {
          await signals.update(savedSignal.id, { riskApproved: false, rejectionReason: failure });
          candleNote = `Signal BUY was not filled. ${escapeHtml(failure)}`;
        }
      }
    } else if (signal.side === "sell") {
      const position = open.find((item) => item.symbol === strategy.symbol);
      if (position) {
        await closePaperPosition(userId, position, ticker.price, "strategy_exit");
      } else if (savedSignal) {
        candleNote = "Signal SELL. No strategy position is open to close.";
      }
    } else if (savedSignal) {
      const stakeNow = stakeOf(latestAccount).virtualXrp;
      candleNote = `Signal ${signal.side.toUpperCase()}. ${escapeHtml(rejectionReason || signal.message)} Virtual stake ${stakeNow.toFixed(2)} XRP.`;
    }

    const remaining = await positions.list(userId);
    const markedNotional = await Promise.all(remaining.map(async (position) => {
      const mark = await freshPositionPrice(
        position.symbol,
        strategy.symbol,
        ticker.price,
        exchange,
      );
      return position.quantity * mark;
    }));
    const openNotional = markedNotional.reduce((sum, value) => sum + value, 0);
    const currentAccount = await accounts.findByUser(userId);
    if (!currentAccount) return;
    const equity = currentAccount.availableBalance + openNotional;
    const highWaterMark = Math.max(currentAccount.highWaterMark, equity);
    const drawdown = highWaterMark > 0 ? (highWaterMark - equity) / highWaterMark * 100 : 0;
    if (drawdown >= account.maxDrawdownPct) {
      await accounts.update(userId, { highWaterMark, state: "halted", emergencyStop: true, updatedAt: new Date() });
      logger.warn({ userId, drawdown }, "Paper engine halted at max drawdown");
    } else {
      await accounts.update(userId, { highWaterMark, updatedAt: new Date() });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown paper engine failure";
    await haltForDataFailure(userId, message);
  } finally {
    if (notify && sawBook) {
      const sent = await announceFills(userId, before).catch(error => {
        logger.warn({ err: error, userId }, "Could not compare paper fills");
        return false;
      });
      if (!sent && candleNote) await tellDesk(userId, candleNote);
    }
    lockedUsers.delete(userId);
  }
}

export async function runPaperStep(userId: string): Promise<string> {
  const before = await positions.list(userId);
  await runUserCycle(userId, false);
  const [open, latestSignals, account] = await Promise.all([
    positions.list(userId),
    signals.list(userId, 1),
    accounts.findByUser(userId),
  ]);
  const stake = account ? stakeOf(account).virtualXrp : DEFAULT_VIRTUAL_XRP;
  const closed = before.filter(position => !open.some(item => item.id === position.id));
  if (closed.length) {
    const position = closed[0];
    return `Sold ${position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${position.symbol}. Virtual stake ${stake.toFixed(2)} XRP. The desk shows this close.`;
  }
  const latest = latestSignals[0];
  if (open.length) {
    const position = open[0];
    return `Open ${position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${position.symbol} at ${position.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}. Virtual stake ${stake.toFixed(2)} XRP. The desk shows this position.`;
  }
  const side = (latest?.side ?? "hold").toUpperCase();
  const why = latest?.rejectionReason || latest?.message || "Waiting for the next candle.";
  return `Signal ${side}. ${why} Virtual stake ${stake.toFixed(2)} XRP.`;
}

const MANUAL_STRATEGY = "manual";
const busyDesk = "The desk is updating a paper order. Try again in a few seconds.";

async function withDeskLock<T>(userId: string, task: () => Promise<T>): Promise<T | typeof busyDesk> {
  if (lockedUsers.has(userId)) return busyDesk;
  lockedUsers.add(userId);
  try {
    return await task();
  } finally {
    lockedUsers.delete(userId);
  }
}

export async function placeManualPaperBuy(userId: string, spendPct: number, orderKey: string): Promise<string> {
  const result = await withDeskLock(userId, async () => {
    if (![25, 50, 100].includes(spendPct)) return "Choose 25%, 50%, or 100% of available cash.";
    const { account } = await ensureUserAccount(userId);
    const symbol = process.env.TRADING_SYMBOL ?? "XRP/USDT";
    const open = await positions.list(userId);
    if (open.some(position => position.symbol === symbol)) {
      return `Close the open ${symbol} position before a new manual buy. The desk already shows it.`;
    }
    if (account.emergencyStop || account.state === "halted") {
      await accounts.update(userId, { emergencyStop: false, state: account.state === "running" ? "running" : "stopped", updatedAt: new Date() });
      account.emergencyStop = false;
      if (account.state === "halted") account.state = "stopped";
    }
    const ticker = await getExchangeAdapter().ticker(symbol);
    if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
      return "Market price is stale. The buy was not sent.";
    }
    const feeRate = account.feeBps / 10_000;
    const stake = stakeOf(account);
    const budgetXrp = stake.virtualXrp * (spendPct / 100);
    const fillPrice = roundMoney(ticker.price * (1 + account.slippageBps / 10_000));
    const quantity = roundQuantity(budgetXrp / (1 + feeRate));
    if (quantity <= 0 || quantity * ticker.price < 5) {
      return "That size is below the 5 USDT paper minimum.";
    }
    const fillFee = roundMoney(quantity * fillPrice * feeRate);
    const slippage = roundMoney(quantity * (fillPrice - ticker.price));
    if (quantity * fillPrice + fillFee > account.availableBalance) {
      return "Available paper balance is insufficient.";
    }
    const base = symbol.split("/")[0];
    const quote = symbol.split("/")[1] ?? "USDT";
    try {
      await orders.insert({
        userId,
        clientOrderId: deterministicId(`manual:buy:${orderKey}`),
        strategyId: MANUAL_STRATEGY,
        strategyName: "Manual",
        symbol,
        side: "buy",
        quantity,
        price: fillPrice,
        fee: fillFee,
        status: "filled",
      });
      await positions.insert({
        userId,
        strategyId: MANUAL_STRATEGY,
        strategyName: "Manual",
        symbol,
        quantity,
        entryPrice: fillPrice,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        highestPrice: fillPrice,
        entryFee: fillFee,
      });
    } catch (error) {
      logger.warn({ err: error, userId }, "Manual paper buy was not filled");
      return "That buy was already filled, or a position is already open.";
    }
    const spent = roundMoney(quantity * fillPrice + fillFee);
    const cash = roundMoney(account.availableBalance - spent);
    const used = Math.min(quantity, stake.virtualXrp);
    const nextStake = roundMoney(Math.max(0.01, stake.virtualXrp - used));
    await accounts.update(userId, { availableBalance: cash, virtualXrp: nextStake, virtualDeployed: used, updatedAt: new Date() });
    const running = account.state === "running" ? " Auto trading is still running. A sell signal closes this position." : "";
    return `Bought ${quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${base} at ${fillPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${quote}. Spent ${spent.toFixed(4)} ${quote}. Virtual cost ${(fillFee + slippage).toFixed(4)} (fee ${fillFee.toFixed(4)}, slippage ${slippage.toFixed(4)}). Virtual stake ${nextStake.toFixed(2)} XRP.${running}`;
  });
  return result;
}

export type PaperReceipt = {
  livePrice: number;
  fillPrice: number;
  quantity: number;
  spent: number;
  fee: number;
  slippage: number;
  virtualCost: number;
  cashLeft: number;
  quote: string;
  base: string;
};

export async function placePaperBuyForQuote(userId: string, spendQuote: number, orderKey: string): Promise<string | { message: string; receipt: PaperReceipt }> {
  const result = await withDeskLock(userId, async () => {
    if (!Number.isFinite(spendQuote) || spendQuote < 5 || spendQuote > 100_000) {
      return "Choose a paper spend from 5 to 100000 USDT.";
    }
    const { account } = await ensureUserAccount(userId);
    const symbol = process.env.TRADING_SYMBOL ?? "XRP/USDT";
    const open = await positions.list(userId);
    if (open.some(position => position.symbol === symbol)) {
      return `Close the open ${symbol} position before a new manual buy. The desk already shows it.`;
    }
    if (account.emergencyStop || account.state === "halted") {
      await accounts.update(userId, { emergencyStop: false, state: account.state === "running" ? "running" : "stopped", updatedAt: new Date() });
      account.emergencyStop = false;
      if (account.state === "halted") account.state = "stopped";
    }
    const ticker = await getExchangeAdapter().ticker(symbol);
    if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
      return "Market price is stale. The buy was not sent.";
    }
    const feeRate = account.feeBps / 10_000;
    const fillPrice = roundMoney(ticker.price * (1 + account.slippageBps / 10_000));
    const quantity = roundQuantity(spendQuote / (fillPrice * (1 + feeRate)));
    if (quantity <= 0 || quantity * ticker.price < 5) {
      return "That size is below the 5 USDT paper minimum.";
    }
    const fillFee = roundMoney(quantity * fillPrice * feeRate);
    const spent = roundMoney(quantity * fillPrice + fillFee);
    if (spent > account.availableBalance + 0.00000001) {
      return "Available paper balance is insufficient.";
    }
    const slippage = roundMoney(quantity * (fillPrice - ticker.price));
    const base = symbol.split("/")[0];
    const quote = symbol.split("/")[1] ?? "USDT";
    try {
      await orders.insert({
        userId,
        clientOrderId: deterministicId(`manual:buy:${orderKey}`),
        strategyId: MANUAL_STRATEGY,
        strategyName: "Manual",
        symbol,
        side: "buy",
        quantity,
        price: fillPrice,
        fee: fillFee,
        status: "filled",
      });
      await positions.insert({
        userId,
        strategyId: MANUAL_STRATEGY,
        strategyName: "Manual",
        symbol,
        quantity,
        entryPrice: fillPrice,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        highestPrice: fillPrice,
        entryFee: fillFee,
      });
    } catch (error) {
      logger.warn({ err: error, userId }, "Quoted paper buy was not filled");
      return "That buy was already filled, or a position is already open.";
    }
    const cash = roundMoney(account.availableBalance - spent);
    const stake = stakeOf(account);
    const used = Math.min(quantity, stake.virtualXrp);
    const nextStake = roundMoney(Math.max(0.01, stake.virtualXrp - used));
    await accounts.update(userId, { availableBalance: cash, virtualXrp: nextStake, virtualDeployed: used, updatedAt: new Date() });
    const virtualCost = roundMoney(fillFee + slippage);
    const message = `Bought ${quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${base} at ${fillPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${quote}. Spent ${spent.toFixed(4)} ${quote}. Virtual cost ${virtualCost.toFixed(4)} (fee ${fillFee.toFixed(4)}, slippage ${slippage.toFixed(4)}). Cash left ${cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote}.`;
    return {
      message,
      receipt: {
        livePrice: ticker.price,
        fillPrice,
        quantity,
        spent,
        fee: fillFee,
        slippage,
        virtualCost,
        cashLeft: cash,
        quote,
        base,
      },
    };
  });
  return result;
}

export async function closeManualPaperPositions(userId: string, orderKey: string): Promise<string> {
  const result = await withDeskLock(userId, async () => {
    await ensureUserAccount(userId);
    const open = await positions.list(userId);
    if (!open.length) return "No open paper position to close.";
    const adapter = getExchangeAdapter();
    const marks = new Map<string, number>();
    for (const position of open) {
      if (marks.has(position.symbol)) continue;
      const ticker = await adapter.ticker(position.symbol);
      if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
        return `Market data for ${position.symbol} is stale. Nothing was closed.`;
      }
      marks.set(position.symbol, ticker.price);
    }
    const lines: string[] = [];
    for (const position of open) {
      await closePaperPosition(userId, position, marks.get(position.symbol) ?? position.entryPrice, "manual_exit", {
        requireRunning: false,
        clientOrderId: deterministicId(`manual:close:${orderKey}:${position.id}`),
      });
      const closed = (await trades.list(userId, 1))[0];
      if (closed && closed.symbol === position.symbol && Date.now() - closed.closedAt.getTime() < 15_000) {
        lines.push(`Closed ${closed.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${closed.symbol} at ${closed.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}. Net ${closed.netPnl >= 0 ? "+" : ""}${closed.netPnl.toFixed(2)}.`);
      } else {
        lines.push(`${position.symbol} was already closed.`);
      }
    }
    const account = await accounts.findByUser(userId);
    if (account) {
      lines.push(`Cash ${account.availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
      lines.push(`Virtual stake ${stakeOf(account).virtualXrp.toFixed(2)} XRP. The desk shows this close.`);
    }
    return lines.join("\n");
  });
  return result;
}

export async function startPaperTrading(userId: string, strategyId: string) {
  const { account } = await ensureUserAccount(userId);
  const strategy = await strategies.findOne(strategyId, userId);
  if (!strategy) throw new Error("Strategy not found.");
  const exchange = getExchangeAdapter();
  const [ticker, candleRows] = await Promise.all([
    exchange.ticker(strategy.symbol),
    exchange.candles(strategy.symbol, strategy.interval, 240),
  ]);
  if (ticker.stale || Date.now() - Date.parse(ticker.updatedAt) > 60_000) {
    throw new Error("Market data is stale; paper trading was not started.");
  }
  if (candleRows.length < Math.max(strategy.params.slowEma, strategy.params.bollingerPeriod) + 5) {
    throw new Error("Not enough complete candles to initialize this strategy.");
  }
  if (account.availableBalance <= 0) {
    throw new Error("Paper balance is exhausted; trading was not started.");
  }
  const openPositions = await positions.list(userId);
  const positionMarks = await Promise.all(openPositions.map(async (position) => {
    const mark = await freshPositionPrice(position.symbol, strategy.symbol, ticker.price, exchange);
    return position.quantity * mark;
  }));
  const equity = account.availableBalance + positionMarks.reduce((sum, value) => sum + value, 0);
  const drawdownPct = account.highWaterMark > 0
    ? Math.max(0, (account.highWaterMark - equity) / account.highWaterMark * 100)
    : 100;
  if (drawdownPct >= account.maxDrawdownPct) {
    throw new Error("Portfolio drawdown is at the configured limit.");
  }
  const closedToday = await trades.since(userId, utcDayStart());
  const realizedToday = closedToday.reduce((sum, trade) => sum + trade.netPnl, 0);
  const unrealizedToday = openPositions.reduce(
    (sum, position, index) =>
      sum + (positionMarks[index] - position.entryPrice * position.quantity) - position.entryFee,
    0,
  );
  const dayStartBalance = account.dayStartedAt < utcDayStart()
    ? equity
    : account.dayStartBalance;
  if (
    dayStartBalance > 0 &&
    -(realizedToday + unrealizedToday) / dayStartBalance * 100 >=
      Math.min(account.maxDailyLossPct, strategy.maxDailyLossPct)
  ) {
    throw new Error("Daily loss limit is reached; paper trading was not started.");
  }

  await strategies.deactivateAll(userId);
  await strategies.update(strategy.id, userId, { active: true, updatedAt: new Date() });
  await accounts.update(userId, {
    state: "running",
    emergencyStop: false,
    activeStrategyId: strategy.id,
    lastMarketUpdate: new Date(ticker.updatedAt),
    dayStartBalance,
    dayStartedAt: account.dayStartedAt < utcDayStart() ? utcDayStart() : account.dayStartedAt,
    updatedAt: new Date(),
  });
  return getTradingStatus(userId);
}

export async function stopPaperTrading(userId: string, emergency = false) {
  await ensureUserAccount(userId);
  await accounts.update(userId, {
    state: emergency ? "halted" : "stopped",
    emergencyStop: emergency,
    updatedAt: new Date(),
  });
  return getTradingStatus(userId);
}

export async function getTradingStatus(userId: string) {
  const { account } = await ensureUserAccount(userId);
  const strategy = account.activeStrategyId
    ? await strategies.findOne(account.activeStrategyId, userId)
    : null;
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
      const active = await accounts.listRunning(100);
      for (const account of active) {
        void runUserCycle(account.userId);
      }
      await watchAboveEntry();
    } catch (error) {
      logger.error({ err: error }, "Paper engine scheduler could not read accounts");
    }
  };
  engineTimer = setInterval(() => void cycle(), ENGINE_INTERVAL_MS);
  engineTimer.unref?.();
  void cycle();
  logger.info({ intervalMs: ENGINE_INTERVAL_MS }, "Paper trading engine initialized");
}