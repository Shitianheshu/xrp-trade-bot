export type TelegramChat = {
  id: string;
  label: string;
};

type TelegramResponse<T> = {
  ok: boolean;
  description?: string;
  result?: T;
};

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

async function callTelegram<T>(token: string, method: string, body?: Record<string, unknown>, timeoutMs = 8_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TelegramError("Telegram could not be reached. Check the network and try again.");
  }
  let payload: TelegramResponse<T>;
  try {
    payload = await response.json() as TelegramResponse<T>;
  } catch {
    throw new TelegramError("Telegram returned a response this desk could not read.");
  }
  if (!payload.ok || payload.result == null) {
    const description = payload.description ?? "";
    if (response.status === 401 || /unauthorized/i.test(description)) {
      throw new TelegramError("Telegram rejected that bot token. Copy a fresh token from BotFather.");
    }
    if (/chat not found/i.test(description) || /bot was blocked/i.test(description)) {
      throw new TelegramError("Open the bot in Telegram and press Start, then save the chat again.");
    }
    throw new TelegramError(description || "Telegram did not accept this request.");
  }
  return payload.result;
}

export async function telegramBotUsername(token: string): Promise<string> {
  const me = await callTelegram<{ username?: string }>(token, "getMe");
  return me.username ? `@${me.username}` : "bot";
}

export async function telegramChats(token: string): Promise<TelegramChat[]> {
  const updates = await callTelegram<Array<{ message?: { chat?: { id?: number; title?: string; username?: string; first_name?: string; type?: string } } }>>(token, "getUpdates");
  const chats = new Map<string, TelegramChat>();
  for (const update of updates) {
    const chat = update.message?.chat;
    if (chat?.id == null) continue;
    const id = String(chat.id);
    const label = chat.title || (chat.username ? `@${chat.username}` : chat.first_name) || id;
    chats.set(id, { id, label: `${label} · ${chat.type ?? "chat"}` });
  }
  return [...chats.values()];
}

export type TelegramButton = { text: string; callback_data: string };

export function telegramInlineKeyboard(rows: TelegramButton[][]): { inline_keyboard: TelegramButton[][] } {
  return { inline_keyboard: rows };
}

export function telegramDeskKeyboard(): { keyboard: string[][]; resize_keyboard: boolean; is_persistent: boolean } {
  return {
    keyboard: [["Complete view", "Chart"], ["Manual trade", "Auto trade"]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function answerTelegramCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await callTelegram(token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text: text?.slice(0, 180),
  });
}

export type TelegramUpdate = {
  update_id: number;
  message?: { chat?: { id?: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
};

export async function telegramUpdates(token: string, offset?: number): Promise<TelegramUpdate[]> {
  return callTelegram<TelegramUpdate[]>(token, "getUpdates", {
    ...(offset == null ? {} : { offset }),
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
  });
}

export async function telegramSetCommands(token: string): Promise<void> {
  await callTelegram(token, "setMyCommands", {
    commands: [
      { command: "menu", description: "Desk menu" },
      { command: "view", description: "Complete desk view" },
      { command: "chart", description: "24 hour price chart" },
      { command: "manual", description: "Manual paper trade" },
      { command: "auto", description: "Start or stop auto trading" },
    ],
  });
}

export function telegramAlarmText(title: string, body: string): string {
  return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}\n\n<i>XRP TradeBot · paper desk</i>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
