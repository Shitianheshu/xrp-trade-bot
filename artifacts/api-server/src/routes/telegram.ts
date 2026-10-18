import { Router, type IRouter } from "express";
import { telegramAlarms, telegramLinks } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import {
  sendTelegramMessage,
  telegramAlarmText,
  telegramBotUsername,
  telegramChats,
  telegramDeskKeyboard,
  TelegramError,
} from "../lib/telegram";

const router: IRouter = Router();
router.use(requireAuth);

const TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;
const CHAT_PATTERN = /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/;

function publicLink(link: { chatId: string; botUsername: string; enabled: boolean; botToken: string }) {
  const tail = link.botToken.slice(-4);
  return {
    connected: true,
    enabled: link.enabled,
    chatId: link.chatId,
    botUsername: link.botUsername,
    tokenHint: `····${tail}`,
  };
}

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  const message = error instanceof TelegramError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Telegram request failed.";
  res.status(400).json({ error: message });
}

router.get("/telegram", async (_req, res): Promise<void> => {
  const link = await telegramLinks.find(authenticatedUserId(res));
  if (!link) {
    res.json({ connected: false, enabled: false, chatId: "", botUsername: "", tokenHint: "" });
    return;
  }
  res.json(publicLink(link));
});

router.post("/telegram/chats", async (req, res): Promise<void> => {
  const token = typeof req.body?.botToken === "string" ? req.body.botToken.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    res.status(400).json({ error: "Paste the bot token from BotFather. It looks like 123456789:AA...." });
    return;
  }
  try {
    const chats = await telegramChats(token);
    res.json({ chats });
  } catch (error) {
    fail(res, error);
  }
});

router.put("/telegram", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const existing = await telegramLinks.find(userId);
  const submittedToken = typeof req.body?.botToken === "string" ? req.body.botToken.trim() : "";
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
  const enabled = req.body?.enabled !== false;
  const botToken = submittedToken || existing?.botToken || "";
  if (!TOKEN_PATTERN.test(botToken)) {
    res.status(400).json({ error: "Paste the bot token from BotFather. It looks like 123456789:AA...." });
    return;
  }
  if (!CHAT_PATTERN.test(chatId)) {
    res.status(400).json({ error: "Enter the numeric chat id, or pick one after you press Start in the bot." });
    return;
  }
  try {
    const botUsername = await telegramBotUsername(botToken);
    await sendTelegramMessage(
      botToken,
      chatId,
      telegramAlarmText("Telegram is connected", "Use Complete view, Chart, Manual trade, and Auto trade in this chat. Orders stay on the paper desk."),
      { reply_markup: telegramDeskKeyboard() },
    );
    const link = { userId, botToken, chatId, botUsername, enabled, updatedAt: new Date() };
    await telegramLinks.save(link);
    res.json(publicLink(link));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/telegram/test", async (_req, res): Promise<void> => {
  const link = await telegramLinks.find(authenticatedUserId(res));
  if (!link) {
    res.status(404).json({ error: "Connect a bot before sending a test." });
    return;
  }
  try {
    await sendTelegramMessage(link.botToken, link.chatId, telegramAlarmText("Test alarm", "If you can read this, the desk can deliver alarms to this chat."));
    res.json({ delivered: true });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/telegram/alarm", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const link = await telegramLinks.find(userId);
  if (!link || !link.enabled) {
    res.json({ delivered: false, reason: link ? "paused" : "not_connected" });
    return;
  }
  const key = typeof req.body?.key === "string" ? req.body.key.trim().slice(0, 160) : "";
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 160) : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 1000) : "";
  if (!key || !title || !body) {
    res.status(400).json({ error: "Alarm title, body, and key are required." });
    return;
  }
  const fresh = await telegramAlarms.claim(userId, key);
  if (!fresh) {
    res.json({ delivered: false, reason: "duplicate" });
    return;
  }
  try {
    await sendTelegramMessage(link.botToken, link.chatId, telegramAlarmText(title, body));
    res.json({ delivered: true });
  } catch (error) {
    await telegramAlarms.release(userId, key);
    fail(res, error);
  }
});

router.delete("/telegram", async (_req, res): Promise<void> => {
  await telegramLinks.remove(authenticatedUserId(res));
  res.json({ connected: false, enabled: false, chatId: "", botUsername: "", tokenHint: "" });
});

export default router;
