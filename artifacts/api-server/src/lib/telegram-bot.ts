import { accounts, positions, signals, strategies, telegramLinks, trades, type TelegramLink } from "@workspace/db";
import { logger } from "./logger";
import { getExchangeAdapter } from "./market-data";
import {
  closeManualPaperPositions,
  getTradingStatus,
  placeManualPaperBuy,
  runPaperStep,
  startPaperTrading,
  stopPaperTrading,
} from "./paper-engine";
import {
  answerTelegramCallback,
  escapeHtml,
  sendTelegramMessage,
  telegramDeskKeyboard,
  telegramInlineKeyboard,
  telegramSetCommands,
  telegramUpdates,
  type TelegramUpdate,
} from "./telegram";

const SYMBOL = () => process.env.TRADING_SYMBOL ?? "XRP/USDT";
const commandsReady = new Set<string>();
const menuSent = new Set<string>();

function money(value: number, digits = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function price(value: number): string {
  return money(value, value >= 100 ? 2 : 4);
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function deskKeyboard() {
  return { reply_markup: telegramDeskKeyboard() };
}

function menuText(): string {
  return [
    "<b>XRP TradeBot</b>",
    "Paper desk. Live orders stay off.",
    "",
    "<b>Complete view</b> · price, cash, positions, and the engine",
    "<b>Chart</b> · last 24 one-hour candles",
    "<b>Manual trade</b> · buy 25%, 50%, or 100% of the virtual stake, or close",
    "<b>Auto trade</b> · start a saved strategy, or stop",
  ].join("\n");
}

async function sendMenu(link: TelegramLink): Promise<void> {
  await sendTelegramMessage(link.botToken, link.chatId, menuText(), deskKeyboard());
  logger.info({ userId: link.userId, chatId: link.chatId }, "Telegram desk menu sent");
}

export async function sendTelegramDeskMenu(token: string, chatId: string): Promise<void> {
  await sendTelegramMessage(token, chatId, menuText(), deskKeyboard());
}

async function completeView(link: TelegramLink): Promise<string> {
  const symbol = SYMBOL();
  const [ticker, status, accountRow, open, recentTrades, recentSignals] = await Promise.all([
    getExchangeAdapter().ticker(symbol),
    getTradingStatus(link.userId),
    accounts.findByUser(link.userId),
    positions.list(link.userId),
    trades.list(link.userId, 5),
    signals.list(link.userId, 3),
  ]);
  const strategy = status.activeStrategyId
    ? await strategies.findOne(status.activeStrategyId, link.userId)
    : null;
  const marks = await Promise.all(open.map(async position => {
    const mark = position.symbol === symbol ? ticker.price : (await getExchangeAdapter().ticker(position.symbol)).price;
    return { position, mark };
  }));
  const positionValue = marks.reduce((sum, row) => sum + row.position.quantity * row.mark, 0);
  const cash = accountRow?.availableBalance ?? 0;
  const equity = cash + positionValue;
  const unrealized = marks.reduce((sum, row) => sum + (row.mark - row.position.entryPrice) * row.position.quantity - row.position.entryFee, 0);
  const lines = [
    `<b>${escapeHtml(symbol)} ${price(ticker.price)}</b>`,
    `24h ${signed(ticker.changePct24h)}% · high ${price(ticker.high24h)} · low ${price(ticker.low24h)}`,
    `Volume ${Math.round(ticker.volume24h).toLocaleString("en-US")}`,
    "",
    `Virtual stake ${money(accountRow?.virtualXrp ?? 200)} XRP`,
    `Equity ${money(equity)} · cash ${money(cash)}`,
    `Unrealized ${signed(unrealized)}`,
    `Engine ${escapeHtml(status.state)}${status.emergencyStop ? " · halt is on" : ""}`,
    strategy ? `Auto ${escapeHtml(strategy.name)} · ${escapeHtml(strategy.symbol)} ${escapeHtml(strategy.interval)}` : "Auto strategy is not selected",
    "",
    marks.length ? "<b>Open positions</b>" : "No open position.",
    ...marks.map(row => {
      const pnl = (row.mark - row.position.entryPrice) * row.position.quantity - row.position.entryFee;
      return `${escapeHtml(row.position.strategyName)} ${row.position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${escapeHtml(row.position.symbol)} @ ${price(row.position.entryPrice)} · mark ${price(row.mark)} · ${signed(pnl)}`;
    }),
  ];
  if (recentTrades.length) {
    lines.push("", "<b>Recent closes</b>");
    for (const trade of recentTrades) {
      lines.push(`${escapeHtml(trade.symbol)} ${signed(trade.netPnl)} · ${escapeHtml(trade.exitReason.replaceAll("_", " "))}`);
    }
  }
  if (recentSignals.length) {
    lines.push("", "<b>Latest signals</b>");
    for (const signal of recentSignals) {
      lines.push(`${signal.side.toUpperCase()} ${escapeHtml(signal.symbol)} · ${escapeHtml(signal.rejectionReason ?? signal.message)}`);
    }
  }
  return lines.join("\n");
}

function sparkline(values: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map(value => blocks[Math.min(blocks.length - 1, Math.round(((value - min) / span) * (blocks.length - 1)))]).join("");
}

async function chartView(_link: TelegramLink): Promise<string> {
  const symbol = SYMBOL();
  let rows;
  try {
    rows = await getExchangeAdapter().candles(symbol, "1h", 30);
  } catch {
    return "A chart is not available from the candle feed right now. Complete view, manual trade, and auto trade still work.";
  }
  const candles = rows.slice(-24);
  if (candles.length < 8) return "The 1-hour candle feed does not have enough bars for a chart yet.";
  const closes = candles.map(candle => candle.close);
  const low = Math.min(...candles.map(candle => candle.low));
  const high = Math.max(...candles.map(candle => candle.high));
  const last = candles[candles.length - 1];
  const column = (value: string, width: number) => value.padStart(width);
  const line = (stamp: string, open: string, high: string, low: string, close: string) =>
    [stamp.padEnd(11), column(open, 8), column(high, 8), column(low, 8), column(close, 8)].join("  ");
  const table = [
    line("UTC", "open", "high", "low", "close"),
    ...candles.slice(-8).map(candle => {
      const stamp = new Date(candle.time).toISOString().slice(5, 16).replace("T", " ");
      return line(stamp, price(candle.open), price(candle.high), price(candle.low), price(candle.close));
    }),
  ].join("\n");
  return [
    `<b>${escapeHtml(symbol)} · 1h chart</b>`,
    `${sparkline(closes)}`,
    `Range ${price(low)} to ${price(high)} · last ${price(last.close)}`,
    "",
    `<pre>${escapeHtml(table)}</pre>`,
  ].join("\n");
}

async function manualPanel(link: TelegramLink): Promise<{ text: string; rows: Array<Array<{ text: string; callback_data: string }>> }> {
  const account = await accounts.findByUser(link.userId);
  const open = await positions.list(link.userId);
  const cash = account?.availableBalance ?? 0;
  const stake = account?.virtualXrp ?? 200;
  const quote = SYMBOL().split("/")[1] ?? "USDT";
  const halt = account?.emergencyStop
    ? "Emergency halt is on. Buy 25%, 50%, or 100% clears it and places the paper order. Close still works."
    : "25%, 50%, and 100% spend that share of the virtual stake. A buy lowers it. Closing a winner raises it.";
  return {
    text: `<b>Manual trade</b>\n\nVirtual stake ${money(stake)} XRP. Cash ${money(cash)} ${escapeHtml(quote)}. ${open.length ? `Open ${open.map(position => escapeHtml(position.symbol)).join(", ")}.` : "No open position."}\n${halt}`,
    rows: [
      [
        { text: "Buy 25%", callback_data: "buy:25" },
        { text: "Buy 50%", callback_data: "buy:50" },
        { text: "Buy 100%", callback_data: "buy:100" },
      ],
      [{ text: "Close position", callback_data: "close" }],
      [{ text: "Back to menu", callback_data: "menu" }],
    ],
  };
}

async function autoPanel(link: TelegramLink): Promise<{ text: string; rows: Array<Array<{ text: string; callback_data: string }>> }> {
  const [status, saved] = await Promise.all([
    getTradingStatus(link.userId),
    strategies.listByUser(link.userId),
  ]);
  const active = saved.find(strategy => strategy.id === status.activeStrategyId);
  const rows = saved.slice(0, 8).map(strategy => [{
    text: `Start ${strategy.name}`.slice(0, 40),
    callback_data: `go:${strategy.id}`,
  }]);
  rows.push([{ text: "Stop auto", callback_data: "stop" }]);
  rows.push([{ text: "Back to menu", callback_data: "menu" }]);
  const headline = status.state === "running"
    ? `Auto trading is running${active ? ` on ${escapeHtml(active.name)}` : ""}.`
    : status.emergencyStop
      ? "Auto trading is halted. Starting a strategy clears the halt."
      : "Auto trading is stopped.";
  const empty = saved.length ? "" : "\n\nSave a strategy on the desk before starting auto trade.";
  return {
    text: `<b>Auto trade</b>\n\n${headline}${empty}\nPaper orders only.`,
    rows,
  };
}

async function reply(link: TelegramLink, text: string, inline?: Array<Array<{ text: string; callback_data: string }>>): Promise<void> {
  await sendTelegramMessage(link.botToken, link.chatId, text, inline
    ? { reply_markup: telegramInlineKeyboard(inline) }
    : deskKeyboard());
}

async function runAction(link: TelegramLink, action: string, orderKey: string): Promise<string> {
  if (action === "view") return completeView(link);
  if (action === "chart") return chartView(link);
  if (action.startsWith("buy:")) {
    const pct = Number(action.slice(4));
    return placeManualPaperBuy(link.userId, pct, orderKey);
  }
  if (action === "close") return closeManualPaperPositions(link.userId, orderKey);
  if (action.startsWith("go:")) {
    const strategyId = action.slice(3);
    try {
      const status = await startPaperTrading(link.userId, strategyId);
      const strategy = await strategies.findOne(strategyId, link.userId);
      const step = await runPaperStep(link.userId);
      return `Auto trading is ${status.state}${strategy ? ` on ${strategy.name}` : ""}. ${step}`;
    } catch (error) {
      return error instanceof Error ? error.message : "Auto trading could not start.";
    }
  }
  if (action === "stop") {
    const status = await stopPaperTrading(link.userId);
    return `Auto trading is ${status.state}. Open positions stay open until you close them. ${status.message}`;
  }
  return menuText();
}

async function showAction(link: TelegramLink, action: string, orderKey: string): Promise<void> {
  if (action === "menu") {
    await sendMenu(link);
    return;
  }
  if (action === "manual") {
    const panel = await manualPanel(link);
    await reply(link, panel.text, panel.rows);
    return;
  }
  if (action === "auto") {
    const panel = await autoPanel(link);
    await reply(link, panel.text, panel.rows);
    return;
  }
  const text = await runAction(link, action, orderKey);
  if (action.startsWith("buy:") || action === "close") {
    const panel = await manualPanel(link);
    await reply(link, `<b>Manual trade</b>\n\n${escapeHtml(text)}\n\n${panel.text.replace("<b>Manual trade</b>\n\n", "")}`, panel.rows);
    return;
  }
  if (action.startsWith("go:") || action === "stop") {
    const panel = await autoPanel(link);
    await reply(link, `<b>Auto trade</b>\n\n${escapeHtml(text)}`, panel.rows);
    return;
  }
  await reply(link, text);
}

function actionFromText(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (value === "/start" || value === "/menu" || value === "/help" || value === "menu") return "menu";
  if (value === "/view" || value === "complete view" || value === "view") return "view";
  if (value === "/chart" || value === "chart") return "chart";
  if (value === "/manual" || value === "manual trade" || value === "manual") return "manual";
  if (value === "/auto" || value === "auto trade" || value === "auto") return "auto";
  if (value === "/close" || value === "/sell") return "close";
  if (value === "/stop") return "stop";
  const buy = /^\/buy(?:\s+)(25|50|100)$/.exec(value);
  if (buy) return `buy:${buy[1]}`;
  return null;
}

async function handleUpdate(link: TelegramLink, update: TelegramUpdate): Promise<void> {
  const callback = update.callback_query;
  const chatId = String(callback?.message?.chat?.id ?? update.message?.chat?.id ?? "");
  if (chatId !== link.chatId) return;
  const orderKey = String(update.update_id);
  try {
    if (callback?.id) {
      const action = callback.data ?? "menu";
      if (!/^(menu|view|chart|manual|auto|close|stop|buy:(25|50|100)|go:[A-Za-z0-9-]{8,40})$/.test(action)) {
        await answerTelegramCallback(link.botToken, callback.id, "That button is no longer available.");
        return;
      }
      await answerTelegramCallback(link.botToken, callback.id);
      await showAction(link, action, orderKey);
      return;
    }
    const text = update.message?.text ?? "";
    if (/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(text.trim())) {
      await reply(link, "The bot token stays on the desk. Use the menu in this chat, and do not paste the token here.");
      return;
    }
    const action = actionFromText(text);
    if (!action) {
      await sendMenu(link);
      return;
    }
    await showAction(link, action, orderKey);
  } catch (error) {
    logger.warn({ userId: link.userId, err: error instanceof Error ? error.message : "telegram action failed" }, "Telegram action failed");
    if (callback?.id) {
      await answerTelegramCallback(link.botToken, callback.id, "The desk could not finish that action.").catch(() => undefined);
    }
    await reply(link, "The desk could not finish that action. Try again in a moment.").catch(() => undefined);
  }
}

async function pollToken(token: string, links: TelegramLink[]): Promise<void> {
  if (!commandsReady.has(token)) {
    try {
      await telegramSetCommands(token);
      commandsReady.add(token);
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : "commands failed" }, "Telegram commands were not registered");
    }
  }
  const stored = links.map(link => link.updateOffset).filter((value): value is number => value != null);
  if (!stored.length) {
    const backlog = await telegramUpdates(token);
    const nextOffset = backlog.reduce((max, update) => Math.max(max, update.update_id), 0) + 1;
    for (const link of links) {
      await sendMenu(link);
      menuSent.add(link.userId);
      await telegramLinks.setOffset(link.userId, nextOffset);
      link.updateOffset = nextOffset;
    }
    return;
  }
  for (const link of links) {
    if (menuSent.has(link.userId)) continue;
    await sendMenu(link);
    menuSent.add(link.userId);
  }
  const offset = Math.min(...stored);
  for (const link of links) {
    if (link.updateOffset != null) continue;
    await telegramLinks.setOffset(link.userId, offset);
    link.updateOffset = offset;
  }
  const updates = await telegramUpdates(token, offset);
  if (!updates.length) return;
  let next = offset;
  for (const update of updates) {
    next = Math.max(next, update.update_id + 1);
    const chatId = String(update.callback_query?.message?.chat?.id ?? update.message?.chat?.id ?? "");
    const link = links.find(item => item.chatId === chatId);
    if (link) await handleUpdate(link, update);
  }
  if (Number.isFinite(next)) {
    for (const link of links) {
      await telegramLinks.setOffset(link.userId, next);
      link.updateOffset = next;
    }
  }
}

async function pollOnce(): Promise<void> {
  const links = await telegramLinks.listConnected();
  const byToken = new Map<string, TelegramLink[]>();
  for (const link of links) {
    const group = byToken.get(link.botToken) ?? [];
    group.push(link);
    byToken.set(link.botToken, group);
  }
  for (const [token, group] of byToken) {
    try {
      await pollToken(token, group);
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : "poll failed" }, "Telegram poll failed");
    }
  }
}

export function startTelegramBot(): void {
  const run = () => {
    void pollOnce().finally(() => {
      setTimeout(run, 2_000).unref?.();
    });
  };
  setTimeout(run, 2_000).unref?.();
}
