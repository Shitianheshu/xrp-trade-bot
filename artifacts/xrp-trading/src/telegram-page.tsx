import { useEffect, useState, type FormEvent } from 'react';
import { Check, Send } from 'lucide-react';
import {
  disconnectTelegram,
  discoverTelegramChats,
  emptyStatus,
  getTelegramStatus,
  saveTelegramLink,
  sendTelegramTest,
  type TelegramChatOption,
  type TelegramStatus,
} from './telegram-client';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const fieldClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary';

export function TelegramPage() {
  const [status, setStatus] = useState<TelegramStatus>(emptyStatus);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [chats, setChats] = useState<TelegramChatOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getTelegramStatus()
      .then(next => {
        if (!active) return;
        setStatus(next);
        setChatId(next.chatId);
        setEnabled(next.connected ? next.enabled : true);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the Telegram connection.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Telegram request failed.');
    } finally {
      setBusy('');
    }
  }

  function findChats() {
    void run('find', async () => {
      const result = await discoverTelegramChats(botToken.trim());
      setChats(result.chats);
      if (!result.chats.length) setMessage('No chats yet. Open the bot in Telegram, press Start, send any message, then look again.');
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run('save', async () => {
      const next = await saveTelegramLink({ botToken: botToken.trim(), chatId: chatId.trim(), enabled });
      setStatus(next);
      setBotToken('');
      setMessage(`Connected ${next.botUsername}. A confirmation is in that Telegram chat, and alarms will follow.`);
    });
  }

  function test() {
    void run('test', async () => {
      await sendTelegramTest();
      setMessage('Test alarm sent. Check the Telegram chat.');
    });
  }

  function disconnect() {
    void run('disconnect', async () => {
      const next = await disconnectTelegram();
      setStatus(next);
      setChatId('');
      setChats([]);
      setMessage('Telegram is disconnected. New alarms stay on this desk.');
    });
  }

  return (
    <div className="space-y-4">
      <div className="page-intro mb-2 px-5 py-5">
        <div className="eyebrow mb-2">Paper alarms</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Telegram</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">Connect your own bot, then open that bot chat, not BotFather. The chat has Complete view, Chart, Manual trade, and Auto trade. Desk snapshots still arrive about every 30 minutes. The token stays on this desk and is not shown again.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <form onSubmit={save} className="panel overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Bot connection</h2>
              <p className="mt-1 text-xs text-muted-foreground">Create the bot with BotFather, then press Start in the chat before saving.</p>
            </div>
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[.07em]', status.connected && status.enabled ? 'bg-primary/15 text-primary' : status.connected ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground')}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {status.connected ? status.enabled ? 'Connected' : 'Paused' : 'Not connected'}
            </span>
          </div>
          {loading ? <div className="space-y-3 p-4"><div className="skeleton h-10 rounded-md" /><div className="skeleton h-10 rounded-md" /></div> : (
            <div className="space-y-4 p-4">
              <label className="block space-y-1.5">
                <span className="eyebrow">Bot token</span>
                <input type="password" autoComplete="off" value={botToken} onChange={event => setBotToken(event.target.value)} placeholder={status.connected ? `Saved ${status.tokenHint}` : '123456789:AA....'} className={fieldClass} data-testid="input-telegram-token" />
              </label>
              <label className="block space-y-1.5">
                <span className="eyebrow">Chat id</span>
                <input required value={chatId} onChange={event => setChatId(event.target.value)} placeholder="Numeric id from the bot chat" className={cx(fieldClass, 'font-mono-data')} data-testid="input-telegram-chat" />
              </label>
              {chats.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {chats.map(chat => (
                    <button key={chat.id} type="button" onClick={() => setChatId(chat.id)} className={cx('rounded-md border px-2.5 py-1.5 text-left text-xs font-semibold', chatId === chat.id ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground')}>
                      {chat.label}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="h-4 w-4 accent-[hsl(142_72%_40%)]" />
                Send alarms to this chat
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={findChats} disabled={Boolean(busy) || !botToken.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-semibold disabled:opacity-50" data-testid="button-telegram-find">{busy === 'find' ? 'Looking…' : 'Find my chat'}</button>
                <button type="submit" disabled={Boolean(busy) || !chatId.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-primary bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="button-telegram-save"><Send size={14} />{busy === 'save' ? 'Connecting…' : 'Save and notify'}</button>
              </div>
            </div>
          )}
          {message && <p className="border-t border-border px-4 py-3 text-xs font-medium text-primary" role="status">{message}</p>}
          {error && <p className="border-t border-border px-4 py-3 text-xs text-destructive">{error}</p>}
        </form>

        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3.5">
            <h2 className="text-sm font-semibold">What arrives in Telegram</h2>
            <p className="mt-1 text-xs text-muted-foreground">Four controls under the chat: Complete view and Chart, then Manual trade and Auto trade.</p>
          </div>
          <ul className="divide-y divide-border text-xs">
            <li className="flex gap-3 px-4 py-3.5"><Check size={14} className="mt-0.5 shrink-0 text-primary" /><span><b className="font-semibold">Complete view.</b> Price, equity, cash, open positions, recent closes, and the engine.</span></li>
            <li className="flex gap-3 px-4 py-3.5"><Check size={14} className="mt-0.5 shrink-0 text-primary" /><span><b className="font-semibold">Manual trade.</b> Buy 25, 50, or 100 percent of paper cash, or close the open position.</span></li>
            <li className="flex gap-3 px-4 py-3.5"><Check size={14} className="mt-0.5 shrink-0 text-primary" /><span><b className="font-semibold">Auto trade.</b> Start a saved strategy or stop the engine. Positions stay open until you close them.</span></li>
            <li className="flex gap-3 px-4 py-3.5"><Check size={14} className="mt-0.5 shrink-0 text-primary" /><span><b className="font-semibold">Chart.</b> Last 24 one-hour candles when the market feed can supply them.</span></li>
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-border bg-muted/25 px-4 py-3">
            <button type="button" onClick={test} disabled={!status.connected || Boolean(busy)} className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-[13px] font-semibold disabled:opacity-50" data-testid="button-telegram-test">{busy === 'test' ? 'Sending…' : 'Send a test alarm'}</button>
            <button type="button" onClick={disconnect} disabled={!status.connected || Boolean(busy)} className="inline-flex min-h-9 items-center rounded-md border border-destructive px-3 text-[13px] font-semibold text-destructive disabled:opacity-50" data-testid="button-telegram-disconnect">Disconnect</button>
          </div>
          {status.connected && <p className="px-4 py-3 text-[11px] text-muted-foreground">Saved bot {status.botUsername} · chat {status.chatId} · token {status.tokenHint}</p>}
        </section>
      </div>

      <section className="panel px-4 py-4 text-xs leading-5 text-muted-foreground">
        In Telegram, open <span className="font-semibold text-foreground">@BotFather</span>, create a bot, and copy the token. Then open your new bot and press <span className="font-semibold text-foreground">Start</span>. Use Find my chat, or paste the chat id, and save. The confirmation message is the proof the alarm path works.
      </section>
    </div>
  );
}
