import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Castle, Crosshair, Crown, Flame, Heart, LogOut, Play, RefreshCw, Swords, Timer, Users, Zap } from 'lucide-react';
import { startBattle, type BattleHud, type BattleResult, type Mode, type Score, type Team } from './tank-battle';
import { currentProfileId } from './demo-profiles';

const ENTRIES = [5, 10, 25, 50] as const;
const SEAT_OPTIONS = [10, 20, 50, 100] as const;
const MODE_LABEL: Record<Mode, string> = { solo: 'Solo', team: 'Castle', tdm: 'TDM' };
const MODE_TITLE: Record<Mode, string> = { solo: 'Solo battle', team: 'Castle battle', tdm: 'Team deathmatch' };
const MODE_TEXT: Record<Mode, string> = {
  solo: 'Every tank for itself. Breaking a tank pays its entry. The last tank running gets its entry back.',
  team: 'Red against Blue. Each side has a castle and respawns there. Break the enemy castle and your side splits the pot.',
  tdm: 'Red against Blue in a neon city. Respawn in 3 seconds with a spawn shield. First side to the kill target splits the pot.',
};

function ModeIcon({ mode, size }: { mode: Mode; size: number }) {
  if (mode === 'solo') return <Crosshair size={size} className="text-primary" />;
  if (mode === 'team') return <Castle size={size} className="text-primary" />;
  return <Zap size={size} className="text-primary" />;
}

type RoomPlayer = { pid: string; callsign: string; team: Team | null; host: boolean; you: boolean; kills: number; deaths: number; taken: number; alive: boolean };
type MyRoom = {
  id: string;
  mode: Mode;
  entry: number;
  seats: number;
  status: 'lobby' | 'battle' | 'done' | 'cancelled';
  pot: number;
  winner: string | null;
  hostName: string;
  isHost: boolean;
  live: boolean;
  you: { pid: string; team: Team | null; taken: number; kills: number; alive: boolean } | null;
  players: RoomPlayer[];
};
type OpenRoom = { id: string; mode: Mode; entry: number; seats: number; players: number; red: number; blue: number; hostName: string; createdAt: string };
type HistoryRow = { id: string; mode: Mode; entry: number; seats: number; paid: number; taken: number; result: 'won' | 'lost' | 'refunded' | 'draw'; score: Score | null; createdAt: string };
type TankView = { virtualXrp: number; room: MyRoom | null; open: OpenRoom[]; history: HistoryRow[] };

function pilotId(): string {
  const saved = sessionStorage.getItem('xrpq-tank-pilot');
  if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
  const next = crypto.randomUUID();
  sessionStorage.setItem('xrpq-tank-pilot', next);
  return next;
}

function callsignKey(): string {
  const profile = currentProfileId();
  return profile ? `xrpq-tank-callsign:${profile}` : 'xrpq-tank-callsign';
}

function savedCallsign(): string {
  const saved = localStorage.getItem(callsignKey());
  if (saved) return saved;
  const profile = currentProfileId();
  return profile ? profile.replace(/^local-/, '').slice(0, 16) : `Pilot-${Math.floor(100 + Math.random() * 900)}`;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The game room did not answer.');
  return data as T;
}

function xrp(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function socketUrl(ticket: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${base}/api/game/tank/live?ticket=${encodeURIComponent(ticket)}`;
}

const teamText: Record<Team, string> = { red: 'Red', blue: 'Blue' };
const teamTone: Record<Team, string> = { red: 'bg-red-50 text-red-700 border-red-200', blue: 'bg-sky-50 text-sky-700 border-sky-200' };

function Choice<T extends string | number>({ value, current, onPick, children, disabled, testId }: { value: T; current: T; onPick: (value: T) => void; children: ReactNode; disabled?: boolean; testId?: string }) {
  return <button type="button" disabled={disabled} onClick={() => onPick(value)} className={`min-h-9 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${current === value ? 'border-primary bg-primary text-white' : 'border-border bg-card hover:bg-muted'}`} data-testid={testId}>{children}</button>;
}

export function TankRoomPage({ stake, onStake }: { stake: number; onStake: () => void }) {
  const [pilot] = useState(pilotId);
  const [callsign, setCallsign] = useState(savedCallsign);
  const [view, setView] = useState<TankView | null>(null);
  const [mode, setMode] = useState<Mode>('solo');
  const [entry, setEntry] = useState<(typeof ENTRIES)[number]>(5);
  const [seats, setSeats] = useState<(typeof SEAT_OPTIONS)[number]>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState<BattleHud | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [battleKey, setBattleKey] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onStakeRef = useRef(onStake);
  onStakeRef.current = onStake;

  useEffect(() => { localStorage.setItem(callsignKey(), callsign); }, [callsign]);

  const refresh = useCallback(async () => {
    const next = await call<TankView>(`/api/game/tank?pilot=${encodeURIComponent(pilot)}`);
    setView(next);
    return next;
  }, [pilot]);

  const room = view?.room ?? null;
  const fighting = room?.status === 'battle' && room.live && !result;

  useEffect(() => {
    if (fighting) return;
    let active = true;
    const load = () => refresh().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'The game room did not answer.'); });
    void load();
    const timer = window.setInterval(load, room?.status === 'lobby' ? 1500 : 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [fighting, refresh, room?.status]);

  useEffect(() => {
    if (!fighting || !room) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let retry = 0;
    call<{ ticket: string }>('/api/game/tank/ticket', { id: room.id, pilot })
      .then(({ ticket }) => {
        if (cancelled) return;
        setError('');
        stop = startBattle(canvas, socketUrl(ticket), {
          onHud: setHud,
          onEnd: outcome => {
            setResult(outcome);
            window.setTimeout(() => { onStakeRef.current(); void refresh(); }, 600);
          },
          onDrop: reason => {
            setError(`${reason} Reconnecting…`);
            retry = window.setTimeout(() => setBattleKey(key => key + 1), 1500);
          },
        });
      })
      .catch(reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'The battle did not open.');
        void refresh();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      stop?.();
    };
  }, [fighting, room?.id, battleKey, pilot, refresh]);

  async function act(path: string, body: Record<string, unknown>, failure: string, leaveFirst?: string) {
    setBusy(true);
    setError('');
    try {
      if (leaveFirst) await call<TankView>('/api/game/tank/leave', { pilot, id: leaveFirst });
      setView(await call<TankView>(path, { pilot, callsign, ...body }));
      onStakeRef.current();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : failure);
      void refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const history = view?.history ?? [];
  const open = view?.open ?? [];
  const free = view?.virtualXrp ?? stake;

  return (
    <div className="space-y-4">
      <div className="page-intro mb-2 flex flex-wrap items-end justify-between gap-4 px-5 py-5">
        <div>
          <div className="eyebrow mb-2">Play</div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Game room</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">Real players, real tanks, one shared battlefield. Pick solo for every tank for itself, or team for Red against Blue with a castle on each side. Entries are virtual XRP from your stake.</p>
        </div>
        <div className="rounded-full bg-[#0B1220] px-3 py-1.5 font-mono-data text-sm font-semibold text-white">{xrp(free)} XRP free</div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs font-semibold text-destructive" role="alert">{error}</p>}

      {result && (
        <ResultPanel result={result} onBack={() => { setResult(null); setHud(null); void refresh(); onStakeRef.current(); }} />
      )}

      {!result && fighting && room && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary"><Swords size={16} /></span>
              <div>
                <h2 className="text-sm font-semibold">{MODE_TITLE[room.mode]} · {room.players.length} tanks · {room.entry} XRP entry</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">W and S drive, A and D turn the hull, the pointer aims the turret. Hold click or space to fire.</p>
              </div>
            </div>
            <BattleBar hud={hud} />
          </div>
          <canvas ref={canvasRef} className="block h-[min(38rem,70vh)] w-full cursor-none touch-none bg-[#3d4a2a]" data-testid="tank-field" />
        </section>
      )}

      {!result && !fighting && room?.status === 'lobby' && (
        <LobbyPanel
          room={room}
          busy={busy}
          onStart={() => void act('/api/game/tank/start', { id: room.id }, 'The battle did not start.')}
          onLeave={() => void act('/api/game/tank/leave', { id: room.id }, 'You could not leave the room.')}
          onTeam={team => void act('/api/game/tank/team', { id: room.id, team }, 'The side did not change.')}
          others={open}
          free={free}
          onMove={id => void act('/api/game/tank/join', { id }, 'You could not join that room.', room.id)}
        />
      )}

      {!result && !fighting && room?.status === 'battle' && !room.live && (
        <section className="panel px-4 py-6 text-sm text-muted-foreground">This battle is closing. Your entry settles in a moment.</section>
      )}

      {!result && !room && (
        <div className="grid gap-4 xl:grid-cols-[.95fr_1.05fr]">
          <section className="panel overflow-hidden">
            <div className="border-b border-border px-4 py-3.5">
              <h2 className="text-sm font-semibold">Open a room</h2>
              <p className="mt-1 text-xs text-muted-foreground">Other players join from the open rooms list. Once two tanks are in, anyone in the room can start.</p>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {(['solo', 'team', 'tdm'] as const).map(item => (
                  <button key={item} type="button" onClick={() => setMode(item)} className={`relative overflow-hidden rounded-xl border p-3 text-left transition-colors ${mode === item ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-muted'}`} data-testid={`button-mode-${item}`}>
                    {item === 'tdm' && <span className="absolute right-2 top-2 rounded-full bg-[#0B1220] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-white">New</span>}
                    <span className="flex items-center gap-2 text-sm font-semibold"><ModeIcon mode={item} size={15} />{MODE_LABEL[item]}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{MODE_TEXT[item]}</span>
                  </button>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold">Entry</p>
                <div className="mt-2 flex flex-wrap gap-2">{ENTRIES.map(amount => <Choice<(typeof ENTRIES)[number]> key={amount} value={amount} current={entry} onPick={setEntry} disabled={busy} testId={`button-entry-${amount}`}>{amount} XRP</Choice>)}</div>
              </div>
              <div>
                <p className="text-xs font-semibold">Room size</p>
                <div className="mt-2 flex flex-wrap gap-2">{SEAT_OPTIONS.map(amount => <Choice<(typeof SEAT_OPTIONS)[number]> key={amount} value={amount} current={seats} onPick={setSeats} disabled={busy} testId={`button-seats-${amount}`}>{amount} tanks</Choice>)}</div>
              </div>
              <label className="block">
                <span className="text-xs font-semibold">Callsign</span>
                <input value={callsign} onChange={event => setCallsign(event.target.value.slice(0, 16))} className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary" placeholder="Your name on the field" data-testid="input-callsign" />
              </label>
              <button type="button" disabled={busy || free < entry} onClick={() => void act('/api/game/tank/rooms', { mode, entry, seats }, 'The room was not opened.')} className="min-h-11 w-full rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" data-testid="button-open-room">{free < entry ? 'Stake is below the entry' : `Open a ${mode} room for ${entry} XRP`}</button>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div>
                <h2 className="text-sm font-semibold">Open rooms</h2>
                <p className="mt-1 text-xs text-muted-foreground">Rooms waiting for players. Joining pays the entry.</p>
              </div>
              <button type="button" onClick={() => void refresh()} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Refresh rooms"><RefreshCw size={14} /></button>
            </div>
            {open.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground"><Users size={17} /></span>
                <p className="text-sm font-semibold">No rooms are waiting</p>
                <p className="mt-1 text-xs text-muted-foreground">Open one and share the moment with another player.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-muted/55 text-[10px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-4 py-2.5">Room</th><th className="px-4 py-2.5">Host</th><th className="px-4 py-2.5">Players</th><th className="px-4 py-2.5">Entry</th><th className="px-4 py-2.5" /></tr></thead>
                  <tbody>
                    {open.map(item => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 font-semibold"><ModeIcon mode={item.mode} size={13} />{MODE_LABEL[item.mode]} · {item.seats}</span></td>
                        <td className="px-4 py-3">{item.hostName}</td>
                        <td className="px-4 py-3 font-mono-data">{item.players}/{item.seats}{item.mode !== 'solo' && <span className="ml-1.5 text-muted-foreground">({item.red}R · {item.blue}B)</span>}</td>
                        <td className="px-4 py-3 font-mono-data">{item.entry} XRP</td>
                        <td className="px-4 py-3 text-right"><button type="button" disabled={busy || item.players >= item.seats || free < item.entry} onClick={() => void act('/api/game/tank/join', { id: item.id }, 'You could not join that room.')} className="min-h-8 rounded-lg border border-primary bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50" data-testid={`button-join-${item.id}`}>Join</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-border px-4 py-3.5">
              <h3 className="text-xs font-semibold">Your recent rooms</h3>
              {history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No rooms have closed yet.</p> : (
                <ul className="mt-2 divide-y divide-border">
                  {history.map(item => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="font-semibold">{MODE_LABEL[item.mode]} · {item.seats}{item.score && <span className="ml-1.5 font-mono-data font-normal text-muted-foreground">{item.score.red}–{item.score.blue}</span>}</span>
                      <span className="font-mono-data text-muted-foreground">{xrp(item.paid)} in</span>
                      <span className={`font-mono-data ${item.result === 'won' ? 'text-primary' : item.result === 'lost' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.result === 'won' ? 'Won' : item.result === 'lost' ? 'Lost' : item.result === 'draw' ? 'Draw' : 'Refunded'} · {xrp(item.taken)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BattleBar({ hud }: { hud: BattleHud | null }) {
  if (!hud) return <span className="text-xs text-muted-foreground">Connecting…</span>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5"><Heart size={13} className={hud.hp > 30 ? 'text-primary' : 'text-destructive'} /><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${hud.hp > 60 ? 'bg-primary' : hud.hp > 30 ? 'bg-amber-500' : 'bg-destructive'}`} style={{ width: `${hud.hp}%` }} /></span><span className="font-mono-data">{hud.alive ? hud.hp : hud.respawnIn ? `${hud.respawnIn}s` : 'out'}</span></span>
      <span className="rounded-lg border border-border px-2.5 py-1.5 font-mono-data">{hud.kills} breaks</span>
      {hud.mode === 'solo' ? <span className="rounded-lg border border-border px-2.5 py-1.5 font-mono-data">{hud.enemies} rivals</span> : <span className="rounded-lg border border-border px-2.5 py-1.5 font-mono-data">{hud.allies + (hud.alive ? 1 : 0)} vs {hud.enemies}</span>}
      {hud.mode === 'solo' && <span className="rounded-lg border border-primary/30 bg-accent px-2.5 py-1.5 font-mono-data font-semibold text-primary">+{xrp(hud.taken)} XRP</span>}
      {hud.score && (
        <span className="inline-flex items-center gap-2 rounded-lg bg-[#0B1220] px-2.5 py-1.5 font-mono-data text-white">
          <span className="font-semibold text-rose-400">{hud.score.red}</span>
          <span className="text-[10px] text-slate-400">to {hud.target}</span>
          <span className="font-semibold text-sky-400">{hud.score.blue}</span>
        </span>
      )}
      {hud.streak >= 2 && <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-mono-data font-semibold text-amber-700"><Flame size={13} />{hud.streak} streak</span>}
      {hud.castles.map(castle => (
        <span key={castle.team} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${teamTone[castle.team]}`}><Castle size={13} /><span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/70"><span className={`block h-full ${castle.team === 'red' ? 'bg-red-500' : 'bg-sky-500'}`} style={{ width: `${(castle.hp / castle.max) * 100}%` }} /></span>{castle.team === hud.team ? 'Yours' : 'Enemy'}</span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1220] px-2.5 py-1.5 font-mono-data text-white"><Timer size={13} />{hud.countdown > 0 ? `Starts ${hud.countdown}` : clock(hud.timeLeft)}</span>
      {!hud.connected && <span className="rounded-lg bg-amber-100 px-2.5 py-1.5 font-semibold text-amber-800">Reconnecting</span>}
    </div>
  );
}

function LobbyPanel({ room, busy, onStart, onLeave, onTeam, others, free, onMove }: { room: MyRoom; busy: boolean; onStart: () => void; onLeave: () => void; onTeam: (team: Team) => void; others: OpenRoom[]; free: number; onMove: (id: string) => void }) {
  const half = Math.ceil(room.seats / 2);
  const red = room.players.filter(player => player.team === 'red');
  const blue = room.players.filter(player => player.team === 'blue');
  const ready = room.mode === 'solo' ? room.players.length >= 2 : red.length >= 1 && blue.length >= 1;
  const waitingFor = room.mode === 'solo' ? 'one more player' : red.length < 1 ? 'a Red player' : 'a Blue player';
  const row = (player: RoomPlayer) => (
    <li key={player.pid} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${player.you ? 'border-primary/40 bg-accent' : 'border-border bg-card'}`}>
      <span className="flex items-center gap-2 font-semibold">{player.host && <Crown size={13} className="text-amber-500" />}{player.callsign}{player.you && <span className="text-[11px] font-normal text-muted-foreground">you</span>}</span>
      {player.team && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] ${teamTone[player.team]}`}>{teamText[player.team]}</span>}
    </li>
  );
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold"><ModeIcon mode={room.mode} size={14} />{MODE_TITLE[room.mode]} · waiting for players</h2>
          <p className="mt-1 text-xs text-muted-foreground">Host {room.hostName}. {room.players.length} of {room.seats} seats taken. Entry {room.entry} XRP. Pot {xrp(room.pot)} XRP.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onLeave} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold hover:bg-muted" data-testid="button-leave-room"><LogOut size={14} />Leave and refund</button>
          {room.you && <button type="button" disabled={busy || !ready} onClick={onStart} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="button-start-battle"><Play size={14} />Start the battle</button>}
        </div>
      </div>
      <div className="p-4">
        {room.mode === 'solo' ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{room.players.map(row)}</ul>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {(['red', 'blue'] as const).map(side => {
              const members = side === 'red' ? red : blue;
              const mine = room.you?.team === side;
              return (
                <div key={side} className={`rounded-xl border p-3 ${side === 'red' ? 'border-red-200 bg-red-50/40' : 'border-sky-200 bg-sky-50/40'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${side === 'red' ? 'text-red-700' : 'text-sky-700'}`}><Castle size={15} />{teamText[side]} side · {members.length}/{half}</span>
                    {!mine && <button type="button" disabled={busy || members.length >= half} onClick={() => onTeam(side)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid={`button-team-${side}`}>Switch here</button>}
                  </div>
                  <ul className="space-y-2">{members.length ? members.map(row) : <li className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">No one on this side yet</li>}</ul>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{ready ? `${room.players.length} players are in. Anyone in the room can start the battle now; more players can still join until then.` : `Waiting for ${waitingFor}. The other player opens the game room with their own ID and clicks Join on this room.`}</p>
      </div>
      {others.length > 0 && (
        <div className="border-t border-border px-4 py-3.5">
          <h3 className="text-xs font-semibold">Other rooms waiting · {others.length}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Someone else may be waiting too. Moving refunds this room and pays the new entry.</p>
          <ul className="mt-2 divide-y divide-border">
            {others.map(item => {
              const cost = item.entry - room.entry;
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold"><ModeIcon mode={item.mode} size={13} />{item.hostName}</span>
                  <span className="font-mono-data text-muted-foreground">{MODE_LABEL[item.mode]} · {item.players}/{item.seats} · {item.entry} XRP</span>
                  <button type="button" disabled={busy || item.players >= item.seats || free < cost} onClick={() => onMove(item.id)} className="min-h-8 rounded-lg border border-primary bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50" data-testid={`button-move-${item.id}`}>Join instead</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResultPanel({ result, onBack }: { result: BattleResult; onBack: () => void }) {
  const mine = result.results.find(row => row.pid === result.you);
  const won = result.mode === 'solo' ? result.winner === result.you : result.winner === result.yourTeam;
  const draw = result.winner == null;
  const winnerName = result.mode === 'solo'
    ? result.results.find(row => row.pid === result.winner)?.callsign
    : result.winner ? `${teamText[result.winner as Team]} side` : null;
  const sorted = [...result.results].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return (
    <section className="panel overflow-hidden">
      <div className={`px-5 py-6 ${won ? 'bg-gradient-to-r from-emerald-50 to-card' : 'bg-gradient-to-r from-muted to-card'}`}>
        <div className="eyebrow">Battle over</div>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-.04em]">{draw ? (result.score ? 'Dead even, entries returned' : 'Time ran out') : won ? 'You won the field' : `${winnerName ?? 'Another tank'} took the field`}</h2>
        {result.score && (
          <div className="mt-3 inline-flex items-center gap-3 rounded-xl bg-[#0B1220] px-4 py-2 font-mono-data text-white">
            <span className="text-2xl font-semibold text-rose-400">{result.score.red}</span>
            <span className="text-[11px] uppercase tracking-[.1em] text-slate-400">Red · first to {result.target} · Blue</span>
            <span className="text-2xl font-semibold text-sky-400">{result.score.blue}</span>
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          You paid {result.entry} XRP and took <span className="font-mono-data font-semibold text-foreground">{xrp(mine?.taken ?? 0)} XRP</span> back
          {result.mode !== 'solo' ? ` from a ${xrp(result.pot)} XRP pot.` : '.'} Your stake is already updated.
        </p>
        <button type="button" onClick={onBack} className="mt-4 min-h-10 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-white" data-testid="button-back-lobby">Back to the rooms</button>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-muted/55 text-[10px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-4 py-2.5">Pilot</th><th className="px-4 py-2.5">Side</th><th className="px-4 py-2.5">Breaks</th><th className="px-4 py-2.5">Broken</th><th className="px-4 py-2.5 text-right">Took</th></tr></thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.pid} className={`border-t border-border ${row.pid === result.you ? 'bg-accent/60' : ''}`}>
                <td className="px-4 py-2.5 font-semibold">{row.callsign}{row.pid === result.you && <span className="ml-1.5 font-normal text-muted-foreground">you</span>}</td>
                <td className="px-4 py-2.5">{row.team ? teamText[row.team] : '—'}</td>
                <td className="px-4 py-2.5 font-mono-data">{row.kills}</td>
                <td className="px-4 py-2.5 font-mono-data">{row.deaths}</td>
                <td className="px-4 py-2.5 text-right font-mono-data">{xrp(row.taken)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
