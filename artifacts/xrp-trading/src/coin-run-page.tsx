import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';

const JUMP_MS = 420;
const COIN_VALUE = 0.28;
const CLEAR_BONUS = 0.5;
const SHRIMP = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f990.svg';
const COIN = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1fa99.svg';

type Beat = { at: number; kind: 'coin' | 'high' | 'pit' };
type RoundStatus = 'running' | 'cleared' | 'fell';
type CoinRound = {
  id: string;
  status: RoundStatus;
  snack: number;
  beats: Beat[];
  startedAt: number;
  coins: number;
  multiple: number;
  payout: number;
  line: string;
};
type HistoryRow = {
  id: string;
  status: 'cleared' | 'fell';
  snack: number;
  coins: number;
  multiple: number;
  payout: number;
  createdAt: string;
};
type CoinView = {
  now: number;
  virtualXrp: number;
  round: CoinRound | null;
  history?: HistoryRow[];
};

async function requestCoin(path: string, body?: unknown): Promise<CoinView> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The course could not answer.');
  return data as CoinView;
}

function xrp(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hopHeight(elapsed: number, jumps: number[]): number {
  for (let index = jumps.length - 1; index >= 0; index -= 1) {
    const jump = jumps[index];
    if (jump == null) continue;
    const delta = elapsed - jump;
    if (delta >= 0 && delta <= JUMP_MS) return Math.sin((delta / JUMP_MS) * Math.PI) * 86;
  }
  return 0;
}

function preview(beats: Beat[], jumps: number[], elapsed: number): { coins: number; fell: boolean } {
  const airborne = (at: number) => jumps.some(jump => at >= jump && at <= jump + JUMP_MS);
  let coins = 0;
  for (const beat of beats) {
    if (beat.at > elapsed) break;
    const up = airborne(beat.at);
    if (beat.kind === 'pit' && !up) return { coins, fell: true };
    if (beat.kind === 'coin' && !up) coins += 1;
    if (beat.kind === 'high' && up) coins += 1;
  }
  return { coins, fell: false };
}

export function CoinRunPage({ stake, onStake }: { stake: number; onStake: () => void }) {
  const [view, setView] = useState<CoinView | null>(null);
  const [snack, setSnack] = useState<1 | 5 | 10>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [jumps, setJumps] = useState<number[]>([]);
  const [shrimpFailed, setShrimpFailed] = useState(false);
  const offsetRef = useRef(0);
  const jumpsRef = useRef<number[]>([]);
  const finishing = useRef(false);

  function apply(next: CoinView) {
    setView(current => ({ ...next, history: next.history ?? current?.history ?? [] }));
    offsetRef.current = next.now - Date.now();
    onStake();
  }

  useEffect(() => {
    let active = true;
    requestCoin('/api/game/coin')
      .then(next => { if (active) apply(next); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'The course could not answer.'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const round = view?.round ?? null;
  const running = round?.status === 'running';

  useEffect(() => {
    jumpsRef.current = jumps;
  }, [jumps]);

  useEffect(() => {
    if (!running || !round) return;
    finishing.current = false;
    setJumps([]);
    jumpsRef.current = [];
    setElapsed(0);
    let frame = 0;
    const paint = () => {
      const nowElapsed = Date.now() + offsetRef.current - round.startedAt;
      setElapsed(nowElapsed);
      const live = preview(round.beats, jumpsRef.current, nowElapsed);
      const end = round.beats[round.beats.length - 1]?.at ?? 0;
      if (!finishing.current && (live.fell || nowElapsed > end + 180)) {
        finishing.current = true;
        void requestCoin('/api/game/coin/finish', { id: round.id, jumps: jumpsRef.current })
          .then(apply)
          .catch(reason => {
            finishing.current = false;
            setError(reason instanceof Error ? reason.message : 'The course could not finish.');
          });
      }
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [running, round?.id]);

  function jump() {
    if (!running || !round) return;
    const at = Date.now() + offsetRef.current - round.startedAt;
    setJumps(current => {
      const previous = current[current.length - 1];
      if (previous != null && at < previous + JUMP_MS) return current;
      const next = [...current, at];
      jumpsRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'ArrowUp') return;
      event.preventDefault();
      jump();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, round?.id]);

  async function feed() {
    setBusy(true);
    setError('');
    try {
      apply(await requestCoin('/api/game/coin/start', { snack }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pip refused the snack.');
    } finally {
      setBusy(false);
    }
  }

  const beats = round?.beats ?? [];
  const live = running ? preview(beats, jumps, elapsed) : null;
  const coins = live?.coins ?? round?.coins ?? 0;
  const height = hopHeight(elapsed, jumps);
  const multiple = running
    ? coins * COIN_VALUE
    : round?.multiple ?? 0;
  const history = view?.history ?? [];

  return (
    <div className="space-y-4">
      <div className="page-intro mb-2 px-5 py-5">
        <div className="eyebrow mb-2">Play</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Coin Run</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">Pip sprints a short paper course. Jump the gaps, grab the high coins, and stay on the ground for the low ones. The snack comes from the virtual stake. Real XRP never moves.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">The course</h2>
              <p className="mt-1 text-xs text-muted-foreground">{round?.line ?? 'Pip is stretching. Feed a snack to start the run.'}</p>
            </div>
            <span className="font-mono-data text-xs text-muted-foreground">{xrp(stake)} XRP free</span>
          </div>

          <button type="button" disabled={!running} onClick={jump} className="relative m-4 block h-72 w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-[#d7e7cf] bg-[#e7f6df] text-left disabled:cursor-default" data-testid="coin-course" aria-label="Jump">
            <div className="absolute inset-x-0 bottom-0 h-16 bg-[#7dbe63]" />
            {beats.map((beat, index) => {
              const x = 22 + (beat.at - elapsed) * 0.055;
              if (!running || x < -12 || x > 112) return null;
              if (beat.kind === 'pit') {
                return <span key={`${beat.at}-${index}`} className="absolute bottom-0 h-16 bg-[#e7f6df]" style={{ left: `calc(${x}% - 28px)`, width: 56 }} />;
              }
              return (
                <img key={`${beat.at}-${index}`} src={COIN} alt="" className="absolute h-8 w-8" style={{ left: `calc(${x}% - 16px)`, bottom: beat.kind === 'high' ? 108 : 52 }} />
              );
            })}
            <span className="absolute bottom-10 h-14 w-14" style={{ left: '18%', transform: `translateY(-${height}px)` }}>
              {shrimpFailed ? <span className="text-4xl" aria-hidden="true">{'><>'}</span> : <img src={SHRIMP} alt="Pip" className="h-14 w-14" onError={() => setShrimpFailed(true)} />}
            </span>
            <span className="absolute left-4 top-4">
              <span className="eyebrow">Coins</span>
              <span className="mt-1 block font-display text-5xl font-semibold tracking-[-.05em] text-primary" data-testid="text-coin-count">{coins}</span>
            </span>
            <span className="absolute right-4 top-4 text-right">
              <Coins className="ml-auto text-[#6d8f57]" size={18} />
              <span className="mt-1 block font-mono-data text-sm text-[#3d5c34]">{multiple.toFixed(2)}x</span>
            </span>
            {!running && <span className="absolute inset-x-0 bottom-20 text-center font-display text-sm font-semibold text-[#3d5c34]">{round?.status === 'cleared' ? 'Course clear' : round?.status === 'fell' ? 'Fell in a gap' : 'Feed a snack to run'}</span>}
          </button>

          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            {([1, 5, 10] as const).map(amount => (
              <button key={amount} type="button" disabled={running || busy} onClick={() => setSnack(amount)} className={`min-h-9 rounded-lg border px-3 text-[13px] font-semibold ${snack === amount ? 'border-primary bg-primary text-white' : 'border-border bg-card'}`} data-testid={`button-coin-snack-${amount}`}>
                {amount} XRP
              </button>
            ))}
            {running ? (
              <button type="button" onClick={jump} className="min-h-11 flex-1 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white" data-testid="button-jump">Jump</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void feed()} className="min-h-11 flex-1 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white" data-testid="button-coin-feed">Feed {snack} XRP</button>
            )}
          </div>
          {error && <p className="px-4 pb-4 text-xs font-semibold text-destructive" role="alert">{error}</p>}
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3.5">
            <h2 className="text-sm font-semibold">How a run pays</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Each coin adds 0.28x. Clearing every gap adds a 0.50x finish bonus. A fall keeps only the coins caught before the gap. Space or the up arrow jumps. Pip is the shrimp from Twemoji, not a borrowed mascot.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4 text-center">
            {[['Low coin', 'Stay down'], ['High coin', 'Jump'], ['Gap', 'Jump']].map(([name, hint]) => (
              <div key={name} className="rounded-lg bg-muted/60 px-2 py-3">
                <p className="text-xs font-semibold">{name}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs font-semibold">Recent runs</p>
          </div>
          {history.length === 0 ? (
            <p className="px-4 pb-5 text-xs text-muted-foreground">No courses have been run yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map(item => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                  <span className="font-semibold">{item.status === 'cleared' ? 'Clear' : 'Fell'}</span>
                  <span className="font-mono-data text-muted-foreground">{item.coins} coins · {item.multiple.toFixed(2)}x</span>
                  <span className={`font-mono-data ${item.payout > item.snack ? 'text-primary' : 'text-destructive'}`}>{item.payout > 0 ? `+${xrp(item.payout)}` : '0.00'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 pb-4 text-[10px] text-muted-foreground">Clear bonus {CLEAR_BONUS.toFixed(2)}x. Character art: Twemoji, CC-BY 4.0.</p>
        </section>
      </div>
    </div>
  );
}
