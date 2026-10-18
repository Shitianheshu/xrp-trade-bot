import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { TradeBriefing } from './trade-briefing';

type OpenAiStatus = { configured: boolean; source: 'saved' | 'environment' | 'none'; hint: string };
type AiNote = { headline: string; summary: string; points: string[]; model: string };

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Use the status below.
  }
  return `OpenAI request failed (${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export function OpenAiPanel({ briefing }: { briefing: TradeBriefing }) {
  const [status, setStatus] = useState<OpenAiStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [note, setNote] = useState<AiNote | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function loadNote(current: OpenAiStatus) {
    if (!current.configured) return;
    setBusy('analyze');
    setError('');
    try {
      const next = await request<AiNote>('/api/openai/briefing', {
        method: 'POST',
        body: JSON.stringify({
          symbol: briefing.symbol,
          deskVerdict: briefing.verdict,
          deskHeadline: briefing.headline,
          deskSummary: briefing.summary,
          stats: briefing.stats,
          factors: briefing.factors.map(factor => ({ label: factor.label, status: factor.status, detail: factor.detail })),
        }),
      });
      setNote(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not write the AI analysis.');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    let active = true;
    request<OpenAiStatus>('/api/openai')
      .then(next => {
        if (!active) return;
        setStatus(next);
        if (next.configured) void loadNote(next);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the OpenAI key status.');
      });
    return () => { active = false; };
    // Reload the note when the desk verdict changes, not on every ticker tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefing.symbol, briefing.verdict]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy('save');
    setError('');
    try {
      const next = await request<OpenAiStatus>('/api/openai', { method: 'PUT', body: JSON.stringify({ apiKey: apiKey.trim() }) });
      setStatus(next);
      setApiKey('');
      await loadNote(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the OpenAI key.');
      setBusy('');
    }
  }

  async function clearKey() {
    setBusy('clear');
    setError('');
    try {
      const next = await request<OpenAiStatus>('/api/openai', { method: 'DELETE' });
      setStatus(next);
      setNote(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove the saved key.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="panel overflow-hidden" data-testid="panel-ai-analysis">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <p className="eyebrow">OpenAI</p>
          <h2 className="mt-1 text-sm font-semibold">AI analysis</h2>
          <p className="mt-1 text-xs text-muted-foreground">The model reads this desk snapshot and writes the note. The key stays on the server.</p>
        </div>
        {status?.configured && (
          <button type="button" onClick={() => void loadNote(status)} disabled={Boolean(busy)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-semibold disabled:opacity-50" data-testid="button-refresh-ai">
            <RefreshCw size={14} />{busy === 'analyze' ? 'Writing…' : 'Refresh AI analysis'}
          </button>
        )}
      </div>
      {!status ? <div className="p-4"><div className="skeleton h-16 rounded-md" /></div> : status.configured ? (
        <div className="px-4 py-4">
          {note ? (
            <div>
              <p className="text-[11px] text-muted-foreground">{note.model} · key {status.hint}{status.source === 'environment' ? ' from the server environment' : ''}</p>
              <h3 className="mt-2 text-base font-semibold" data-testid="text-ai-headline">{note.headline}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{note.summary}</p>
              {note.points.length > 0 && <ul className="mt-3 space-y-2 text-xs leading-5 text-foreground">{note.points.map(point => <li key={point} className="flex gap-2"><Sparkles size={13} className="mt-0.5 shrink-0 text-primary" />{point}</li>)}</ul>}
            </div>
          ) : busy === 'analyze' ? <p className="text-xs text-muted-foreground">Writing the analysis from the live snapshot…</p> : <p className="text-xs text-muted-foreground">The key is saved. Refresh to write the note.</p>}
          {status.source === 'saved' && <button type="button" onClick={() => void clearKey()} disabled={Boolean(busy)} className="mt-4 text-[11px] font-semibold text-muted-foreground hover:text-foreground">Remove saved key</button>}
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3 px-4 py-4">
          <p className="text-xs leading-5 text-muted-foreground">Paste an OpenAI API key that starts with sk-. It is checked with OpenAI, then stored for this desk. You can also set OPENAI_API_KEY on the API server instead of pasting it here.</p>
          <input type="password" autoComplete="off" required value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-..." className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-openai-key" />
          <button type="submit" disabled={Boolean(busy) || !apiKey.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-primary bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="button-save-openai-key"><Sparkles size={14} />{busy === 'save' ? 'Checking key…' : 'Save key and analyze'}</button>
        </form>
      )}
      {error && <p className="border-t border-border px-4 py-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}
