export type TelegramStatus = {
  connected: boolean;
  enabled: boolean;
  chatId: string;
  botUsername: string;
  tokenHint: string;
};

export type TelegramChatOption = { id: string; label: string };

const emptyStatus: TelegramStatus = { connected: false, enabled: false, chatId: '', botUsername: '', tokenHint: '' };

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Fall through to the status line.
  }
  return `Telegram request failed (${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export function getTelegramStatus() {
  return request<TelegramStatus>('/api/telegram');
}

export function discoverTelegramChats(botToken: string) {
  return request<{ chats: TelegramChatOption[] }>('/api/telegram/chats', {
    method: 'POST',
    body: JSON.stringify({ botToken }),
  });
}

export function saveTelegramLink(input: { botToken: string; chatId: string; enabled: boolean }) {
  return request<TelegramStatus>('/api/telegram', { method: 'PUT', body: JSON.stringify(input) });
}

export function sendTelegramTest() {
  return request<{ delivered: boolean }>('/api/telegram/test', { method: 'POST', body: '{}' });
}

export function disconnectTelegram() {
  return request<TelegramStatus>('/api/telegram', { method: 'DELETE' });
}

export async function deliverTelegramAlarm(alarm: { key: string; title: string; body: string }) {
  try {
    return await request<{ delivered: boolean; reason?: string }>('/api/telegram/alarm', { method: 'POST', body: JSON.stringify(alarm) });
  } catch {
    return { delivered: false, reason: 'failed' };
  }
}

export { emptyStatus };
