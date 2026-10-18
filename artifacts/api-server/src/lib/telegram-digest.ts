import { accounts, signals, strategies, telegramAlarms, telegramLinks } from "@workspace/db";
import { logger } from "./logger";
import { getExchangeAdapter } from "./market-data";
import { sendTelegramMessage, telegramAlarmText } from "./telegram";

const DIGEST_MS = 30 * 60 * 1000;

function money(value: number, digits = 4): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export async function publishTelegramDigests(): Promise<void> {
  const links = await telegramLinks.listEnabled();
  const bucket = Math.floor(Date.now() / DIGEST_MS);
  for (const link of links) {
    const key = `digest:${link.chatId}:${bucket}`;
    const fresh = await telegramAlarms.claim(link.userId, key);
    if (!fresh) continue;
    try {
      const symbol = process.env.TRADING_SYMBOL ?? "XRP/USDT";
      const [ticker, account, recent] = await Promise.all([
        getExchangeAdapter().ticker(symbol),
        accounts.findByUser(link.userId),
        signals.list(link.userId, 1),
      ]);
      const strategy = account?.activeStrategyId
        ? await strategies.findOne(account.activeStrategyId, link.userId)
        : null;
      const latest = recent[0];
      const lines = [
        `${ticker.symbol} ${money(ticker.price)}`,
        `24h ${ticker.changePct24h >= 0 ? "+" : ""}${ticker.changePct24h.toFixed(2)}%`,
        `High ${money(ticker.high24h)} · Low ${money(ticker.low24h)}`,
        `Volume ${Math.round(ticker.volume24h).toLocaleString("en-US")}`,
        account
          ? `Engine ${account.state}${account.emergencyStop ? " · halt is on" : ""}`
          : "Engine unknown",
        strategy ? `Strategy ${strategy.name} · ${strategy.symbol} ${strategy.interval}` : "No active strategy",
        latest ? `Latest signal ${latest.side.toUpperCase()} ${latest.symbol}: ${latest.rejectionReason ?? latest.message}` : "No paper signals yet",
        "Send /menu for the complete view, chart, manual trade, and auto trade.",
      ];
      await sendTelegramMessage(link.botToken, link.chatId, telegramAlarmText("Desk update", lines.join("\n")));
      logger.info({ userId: link.userId, chatId: link.chatId }, "Telegram digest sent");
    } catch (error) {
      await telegramAlarms.release(link.userId, key);
      logger.warn({ userId: link.userId, err: error instanceof Error ? error.message : "send failed" }, "Telegram digest failed");
    }
  }
}

export function startTelegramDigest(): void {
  const run = () => {
    void publishTelegramDigests().catch(error => {
      logger.warn({ err: error instanceof Error ? error.message : "digest failed" }, "Telegram digest failed");
    });
  };
  setInterval(run, DIGEST_MS).unref?.();
}
