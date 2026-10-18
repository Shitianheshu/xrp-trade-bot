import { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';

const GROWTH = 0.22;

type RoundStatus = 'running' | 'torn' | 'jammed';
type StampRound = {
  id: string;
  status: RoundStatus;
  snack: number;
  multiple: number;
  payout: number;
  line: string;
  startedAt: number;
};
type HistoryRow = {
  id: string;
  status: 'torn' | 'jammed';
  snack: number;
  multiple: number;
  payout: number;
  createdAt: string;
};
type StampView = {
  now: number;
  virtualXrp: number;
  round: StampRound | null;
  history?: HistoryRow[];
};

function multipleAt(startedAt: number, now: number): number {
  const raw = Math.exp(GROWTH * Math.max(0, now - startedAt) / 1000);
  return Math.round(Math.min(25, raw) * 100) / 100;
}

async function requestStamp(path: string, body?: unknown): Promise<StampView> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The printer could not answer.');
  return data as StampView;
}

function xrp(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StampChasePage({ stake, onStake }: { stake: number; onStake: () => void }) {
  const [view, setView] = useState<StampView | null>(null);
  const [snack, setSnack] = useState<1 | 5 | 10>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(1);
  const offsetRef = useRef(0);

  function apply(next: StampView) {
    setView(current => ({ ...next, history: next.history ?? current?.history ?? [] }));
    offsetRef.current = next.now - Date.now();
    if (next.round?.status === 'running') setShown(multipleAt(next.round.startedAt, next.now));
    else if (next.round) setShown(next.round.multiple);
    onStake();
  }

  useEffect(() => {
    let active = true;
    requestStamp('/api/game/stamp')
      .then(next => { if (active) apply(next); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'The printer could not answer.'); });
    return () => { active = false; };
    // The desk stake refresh is stable enough for the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = view?.round?.status === 'running';

  useEffect(() => {
    if (!running || !view?.round) return;
    const startedAt = view.round.startedAt;
    let timer = 0;
    const paint = () => {
      setShown(multipleAt(startedAt, Date.now() + offsetRef.current));
      timer = window.setTimeout(paint, 50);
    };
    paint();
    const poll = window.setInterval(() => {
      void requestStamp('/api/game/stamp').then(apply).catch(() => undefined);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [running, view?.round?.id]);

  async function feed() {
    setBusy(true);
    setError('');
    try {
      apply(await requestStamp('/api/game/stamp/start', { snack }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The shrimp refused the snack.');
    } finally {
      setBusy(false);
    }
  }

  async function tear() {
    if (!view?.round) return;
    setBusy(true);
    setError('');
    try {
      apply(await requestStamp('/api/game/stamp/tear', { id: view.round.id }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The receipt would not tear.');
    } finally {
      setBusy(false);
    }
  }

  const round = view?.round ?? null;
  const display = running ? shown : round?.multiple ?? 1;
  const progress = Math.min(90, Math.log(Math.max(display, 1)) / Math.log(25) * 88);
  const stamped = round?.status === 'jammed';
  const torn = round?.status === 'torn';
  const history = view?.history ?? [];

  return (
    <div className="space-y-4">
      <div className="page-intro mb-2 px-5 py-5">
        <div className="eyebrow mb-2">Play</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Stamp Chase</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">A paper shrimp runs across a receipt. A rubber stamp chases it. Tear the receipt before the stamp lands. Snacks come from the virtual stake. Real XRP never moves.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">The receipt</h2>
              <p className="mt-1 text-xs text-muted-foreground">{round?.line ?? 'The stamp is inking its pad.'}</p>
            </div>
            <span className="font-mono-data text-xs text-muted-foreground">{xrp(stake)} XRP free</span>
          </div>

          <div className="relative m-4 h-72 overflow-hidden rounded-xl border border-[#e4dcc8] bg-[#f7f3ea]" data-testid="stamp-receipt">
            <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 27px, rgba(180,160,120,.35) 28px)' }} />
            <div className="relative flex items-end justify-between px-5 pt-6">
              <div>
                <p className="eyebrow">Printed multiple</p>
                <p className={`font-display text-6xl font-semibold tracking-[-.05em] ${stamped ? 'text-destructive' : 'text-primary'}`} data-testid="text-stamp-multiple">{display.toFixed(2)}x</p>
              </div>
              <Printer className="text-[#8a7a62]" size={22} />
            </div>
            <div className="absolute inset-x-5 bottom-16 h-3 rounded-full bg-[#efe6d4]">
              <span className="absolute top-1/2 -translate-y-1/2 text-lg" style={{ left: `${stamped ? progress : Math.max(0, progress - 16)}%` }} aria-hidden="true">▦</span>
              <span className="absolute -top-3 text-lg motion-safe:animate-bounce" style={{ left: `${progress}%` }} aria-hidden="true">{'><>'}</span>
            </div>
            <p className="absolute inset-x-0 bottom-5 text-center font-display text-sm font-semibold tracking-[-.03em] text-[#6d5e48]">
              {stamped ? 'STAMPED' : torn ? 'TORN' : running ? 'The shrimp is spending the snack.' : 'Feed a snack to start the chase.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            {([1, 5, 10] as const).map(amount => (
              <button key={amount} type="button" disabled={running || busy} onClick={() => setSnack(amount)} className={`min-h-9 rounded-lg border px-3 text-[13px] font-semibold ${snack === amount ? 'border-primary bg-primary text-white' : 'border-border bg-card'}`} data-testid={`button-snack-${amount}`}>
                {amount} XRP
              </button>
            ))}
            {running ? (
              <button type="button" disabled={busy} onClick={() => void tear()} className="min-h-11 flex-1 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white" data-testid="button-tear">Tear the receipt</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void feed()} className="min-h-11 flex-1 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white" data-testid="button-feed">Feed {snack} XRP</button>
            )}
          </div>
          {error && <p className="px-4 pb-4 text-xs font-semibold text-destructive" role="alert">{error}</p>}
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3.5">
            <h2 className="text-sm font-semibold">How the chase works</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">The printer keeps a little ink. Most chases run, a few stamps land at once, and none of them can pass 25x. Tearing early returns a short receipt. Waiting prints a longer one, until the stamp arrives.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4 text-center">
            {[['1 XRP', 'A polite shrimp'], ['5 XRP', 'A handful'], ['10 XRP', 'Break room']].map(([amount, name]) => (
              <div key={amount} className="rounded-lg bg-muted/60 px-2 py-3">
                <p className="font-mono-data text-xs font-semibold">{amount}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{name}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs font-semibold">Recent tears</p>
          </div>
          {history.length === 0 ? (
            <p className="px-4 pb-5 text-xs text-muted-foreground">No snacks have been stamped yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map(item => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                  <span className="font-semibold">{item.status === 'torn' ? 'Torn' : 'Stamped'}</span>
                  <span className="font-mono-data text-muted-foreground">{item.multiple.toFixed(2)}x · {xrp(item.snack)} in</span>
                  <span className={`font-mono-data ${item.payout > item.snack ? 'text-primary' : 'text-destructive'}`}>{item.payout > 0 ? `+${xrp(item.payout)}` : '0.00'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
