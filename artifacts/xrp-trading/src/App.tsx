import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BookOpen, Bot, Gamepad2, Receipt, Send, Sparkles, Wallet,
  Check, ChevronDown, Clock3, Coins, Crosshair, FileChartColumn,
  FlaskConical, Gauge, History, LayoutDashboard, LockKeyhole, LogOut, Menu, Plus, Printer, RefreshCw, Search,
  Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal, Target,
  TrendingUp, X,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getGetBacktestQueryKey,
  getGetBacktestsQueryKey,
  getGetMarketOhlcvQueryKey,
  getGetMarketTickerQueryKey,
  getGetPaperValidationQueryKey,
  getGetPortfolioQueryKey,
  getGetRiskSettingsQueryKey,
  getGetStrategiesQueryKey,
  getGetTradingDashboardQueryKey,
  getGetTradingStatusQueryKey,
  useCreateStrategy,
  useEmergencyStopTrading,
  useGetBacktest,
  useGetBacktests,
  useGetMarketOhlcv,
  useGetMarketTicker,
  useGetOrders,
  useGetPaperValidation,
  useGetPortfolio,
  useGetPositions,
  useGetReadiness,
  useGetRiskSettings,
  getGetSignalsQueryKey,
  useGetSignals,
  useGetStrategies,
  useGetTradingDashboard,
  useGetTradingStatus,
  useGetTrades,
  useRunBacktest,
  useStartPaperTrading,
  useStopPaperTrading,
  useUpdateRiskSettings,
  useUpdateStrategy,
  type Backtest,
  type BacktestInput,
  type Candle,
  type MarketTicker,
  type RiskSettings,
  type RiskSettingsInput,
  type Strategy,
  type StrategyInput,
} from '@workspace/api-client-react';
import { AnalysisPage } from './analysis-page';
import { DemoPage } from './demo-page';
import { CoinRunPage } from './coin-run-page';
import { TankRoomPage } from './tank-room-page';
import { StampChasePage } from './stamp-chase-page';
import { TelegramPage } from './telegram-page';
import { XrpWalletPage } from './xrp-wallet-page';
import { useTradeAlerts } from './trade-briefing';
import { currentProfileId, DEFAULT_PROFILE, installDemoFetch, listProfiles, LOGIN_ID_PATTERN, loginWithId, normalizeLoginId, profileFromId, removeProfile, setCurrentProfile, type DemoProfile } from './demo-profiles';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 12_000, refetchOnWindowFocus: true, retry: 1 } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const explicitClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? '';
const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(window.location.hostname);
// Host-derived keys point at clerk.<hostname>. On localhost that host does not exist.
const clerkPubKey = localHost
  ? explicitClerkKey
  : publishableKeyFromHost(window.location.hostname, explicitClerkKey || undefined);
const demoMode = !clerkPubKey;
if (demoMode) installDemoFetch(basePath);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const DEMO_SESSION_KEY = 'xrpq-demo-session';
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
type SessionUser = { firstName: string; email: string; initial: string };
type SessionValue = { signedIn: boolean; user: SessionUser; signIn: () => void; signOut: () => void; switchUser?: () => void };
const SessionContext = createContext<SessionValue | null>(null);
type DemoProfilesValue = {
  profiles: DemoProfile[];
  current: DemoProfile | null;
  enterAs: (profile: DemoProfile) => void;
  login: (id: string) => boolean;
  remove: (id: string) => void;
};
const DemoProfilesContext = createContext<DemoProfilesValue | null>(null);
function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session is not available');
  return value;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2ee6c0',
    colorForeground: '#eef3f8',
    colorMutedForeground: '#9aa6b5',
    colorDanger: '#ff5d7a',
    colorBackground: '#0c121c',
    colorInput: '#121a26',
    colorInputForeground: '#eef3f8',
    colorNeutral: '#243044',
    fontFamily: 'Outfit, sans-serif',
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#0c121c] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#243044]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#eef3f8] font-semibold',
    headerSubtitle: 'text-[#9aa6b5]',
    socialButtonsBlockButtonText: 'text-[#eef3f8] font-medium',
    formFieldLabel: 'text-[#c5d0dc] font-medium',
    footerActionLink: 'text-[#2ee6c0] font-semibold',
    footerActionText: 'text-[#9aa6b5]',
    dividerText: 'text-[#9aa6b5]',
    identityPreviewEditButton: 'text-[#2ee6c0]',
    formFieldSuccessText: 'text-[#2ee6c0]',
    alertText: 'text-[#7f332d]',
    logoBox: 'mb-3',
    logoImage: 'max-h-9',
    socialButtonsBlockButton: 'border-[#243044] bg-[#121a26]',
    formButtonPrimary: 'bg-[#2ee6c0] hover:bg-[#5cf0d2] text-[#071018] shadow-none',
    formFieldInput: 'bg-[#121a26] border-[#243044] text-[#eef3f8]',
    footerAction: 'border-t border-[#243044]',
    dividerLine: 'bg-[#243044]',
    alert: 'bg-[#3a1822] border-[#6b3040]',
    otpCodeFieldInput: 'bg-[#121a26] border-[#243044]',
    formFieldRow: 'gap-1',
    main: 'gap-4',
  },
};

type IconType = typeof LayoutDashboard;
type NavItem = { label: string; path: string; icon: IconType };
const navGroups: { label: string; items: NavItem[] }[] = [
  { label: 'Desk', items: [
    { label: 'Dashboard', path: '/user-portal', icon: LayoutDashboard },
    { label: 'Trading', path: '/user-portal#trading', icon: TrendingUp },
    { label: 'Trade History', path: '/activity', icon: History },
  ] },
  { label: 'Research', items: [
    { label: 'AI analysis', path: '/analysis', icon: Sparkles },
    { label: 'Strategies', path: '/strategies', icon: Crosshair },
    { label: 'Backtesting', path: '/backtests', icon: FileChartColumn },
  ] },
  { label: 'Money', items: [
    { label: 'XRP wallet', path: '/xrp-wallet', icon: ArrowUpRight },
    { label: 'Demo', path: '/demo', icon: FlaskConical },
  ] },
  { label: 'Play', items: [
    { label: 'Stamp Chase', path: '/stamp-chase', icon: Printer },
    { label: 'Coin Run', path: '/coin-run', icon: Coins },
    { label: 'Game room', path: '/game-room', icon: Target },
  ] },
  { label: 'Signals', items: [
    { label: 'Notifications', path: '/notifications', icon: Bell },
    { label: 'Telegram', path: '/telegram', icon: Send },
  ] },
  { label: 'Account', items: [
    { label: 'Settings', path: '/settings', icon: Settings2 },
  ] },
];

function fmt(value?: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const DOLLAR_QUOTES = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD']);

function money(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return '—';
  const code = currency.trim().toUpperCase() || 'USD';
  const iso = DOLLAR_QUOTES.has(code) ? 'USD' : code;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: iso, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${fmt(value)} ${code}`;
  }
}
function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function percent(value?: number | null) {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${fmt(value)}%`;
}
function cx(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(' '); }

function Button({ children, variant = 'solid', className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'outline' | 'ghost' | 'danger' }) {
  const variants = {
    solid: 'bg-primary text-white hover:bg-primary/90 border-primary',
    outline: 'border-border bg-card text-foreground hover:bg-muted',
    ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'border-destructive bg-destructive text-white hover:bg-destructive/90',
  };
  return <button type={type} {...props} className={cx('inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-[13px] font-semibold leading-none tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)}>{children}</button>;
}
function Panel({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cx('panel', className)}>{children}</section>;
}
function PanelHeader({ title, aside, detail }: { title: string; aside?: ReactNode; detail?: string }) {
  return <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5"><div><h2 className="text-sm font-semibold tracking-[-.015em]">{title}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{aside}</div>;
}
function Skeleton({ className = '' }: { className?: string }) { return <div className={cx('skeleton rounded-md', className)} aria-label="Loading" />; }
function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return <Panel className="p-4"><Skeleton className="mb-5 h-4 w-36" />{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="mb-3 h-8 w-full" />)}</Panel>;
}
function QueryState({ loading, error, empty, retry, note, children }: { loading?: boolean; error?: boolean; empty?: boolean; retry?: () => void; note?: string; children: ReactNode }) {
  if (loading) return <LoadingPanel />;
  if (error) return <Panel className="flex flex-col items-start gap-2 p-6"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} className="text-destructive" />Could not load this data</div><p className="text-xs text-muted-foreground">The API did not return a current snapshot. Nothing has been substituted.</p><Button variant="outline" onClick={retry}><RefreshCw size={14} />Try again</Button></Panel>;
  if (empty) return <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-10 text-center"><span className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground"><BookOpen size={16} /></span><p className="text-sm font-semibold">No records yet</p><p className="mt-1 text-xs text-muted-foreground">{note ?? 'New activity will appear here when the API reports it.'}</p></div>;
  return <>{children}</>;
}
function TableWrap({ children }: { children: ReactNode }) { return <div className="overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>; }
function TableHead({ children }: { children: ReactNode }) { return <thead className="bg-muted/55 text-[10px] uppercase tracking-[.1em] text-muted-foreground">{children}</thead>; }
function EmptyCell({ children, colSpan }: { children: ReactNode; colSpan: number }) { return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</td></tr>; }
function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'neutral' }) {
  const tones = { good: 'bg-primary/15 text-primary', bad: 'bg-destructive/15 text-destructive', warn: 'bg-amber-100 text-amber-700', neutral: 'bg-muted text-muted-foreground' };
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[.07em]', tones[tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}
function MoneyValue({ value, currency = 'USD' }: { value?: number | null; currency?: string }) {
  return <span className={cx('font-mono-data tabular-nums', (value ?? 0) > 0 && 'text-primary', (value ?? 0) < 0 && 'text-destructive')}>{money(value, currency)}</span>;
}
function Metric({ label, value, note, icon: Icon, tone = 'default' }: { label: string; value: ReactNode; note?: ReactNode; icon: IconType; tone?: 'default' | 'positive' | 'negative' }) {
  return <Panel className="relative overflow-hidden px-4 py-4"><div className="flex items-center justify-between"><span className="eyebrow">{label}</span><Icon size={15} className="text-muted-foreground" /></div><div className={cx('mt-3 font-display text-[26px] font-semibold leading-none tracking-[-.035em]', tone === 'positive' && 'text-primary', tone === 'negative' && 'text-destructive')}>{value}</div>{note && <div className="mt-2 text-[11px] text-muted-foreground">{note}</div>}</Panel>;
}
function PageHeading({ eyebrow = 'PAPER ENVIRONMENT', title, detail, action }: { eyebrow?: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-intro mb-6 flex flex-wrap items-end justify-between gap-4 px-5 py-5"><div><div className="eyebrow mb-2">{eyebrow}</div><h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">{title}</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{detail}</p></div>{action}</div>;
}

function useMarketStream(symbol: string, fallback?: MarketTicker) {
  const [latest, setLatest] = useState<{ symbol: string; ticker: MarketTicker }>();
  const [state, setState] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      setState(attempts === 0 ? 'connecting' : 'reconnecting');
      const url = new URL(`${basePath}/api/stream`, window.location.origin);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('symbol', symbol);
      try {
        socket = new WebSocket(url);
        socket.onopen = () => {
          attempts = 0;
          setState('live');
        };
        socket.onmessage = (event: MessageEvent<string>) => {
          try {
            const ticker = JSON.parse(event.data) as MarketTicker;
            if (ticker.symbol === symbol && Number.isFinite(ticker.price)) {
              setLatest({ symbol, ticker });
            }
          } catch {
            // Keep the last verified exchange snapshot if a stream frame is malformed.
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          if (stopped) return;
          attempts += 1;
          setState('reconnecting');
          retryTimer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts - 1, 5), 30_000));
        };
      } catch {
        attempts += 1;
        setState('reconnecting');
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts - 1, 5), 30_000));
      }
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [symbol]);
  return {
    ticker: latest?.symbol === symbol ? latest.ticker : fallback,
    state,
  };
}

const DESK_PAIRS = ['XRP/USDT', 'XRP/USDC', 'XRP/BTC', 'XRP/ETH'] as const;
const VIRTUAL_XRP_KEY = 'xrpq-virtual-xrp';
function readVirtualXrp() {
  const saved = Number(sessionStorage.getItem(VIRTUAL_XRP_KEY));
  return Number.isFinite(saved) && saved > 0 ? saved : 200;
}
function writeVirtualXrp(amount: number) {
  const next = Math.max(0.01, Math.min(amount, 1_000_000));
  sessionStorage.setItem(VIRTUAL_XRP_KEY, String(next));
  return next;
}
type DeskMarketValue = {
  symbol: string;
  setSymbol: (symbol: string) => void;
  ticker?: MarketTicker;
  state: 'connecting' | 'live' | 'reconnecting';
  virtualXrp: number;
  setVirtualXrp: (amount: number) => void;
  refreshStake: () => Promise<void>;
};
const DeskMarketContext = createContext<DeskMarketValue>({
  symbol: 'XRP/USDT',
  setSymbol: () => {},
  state: 'connecting',
  virtualXrp: 200,
  setVirtualXrp: () => {},
  refreshStake: async () => {},
});
function useDeskMarket() { return useContext(DeskMarketContext); }
function DeskMarketProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState('XRP/USDT');
  const [virtualXrp, setVirtualXrpState] = useState(readVirtualXrp);
  const tickerParams = { symbol };
  const ticker = useGetMarketTicker(tickerParams, { query: { queryKey: getGetMarketTickerQueryKey(tickerParams), refetchInterval: 30_000 } });
  const stream = useMarketStream(symbol, ticker.data);
  const applyStake = useCallback((amount: number) => {
    const next = writeVirtualXrp(amount);
    setVirtualXrpState(next);
    return next;
  }, []);
  const refreshStake = useCallback(async () => {
    const response = await fetch('/api/trading/virtual-stake');
    if (!response.ok) return;
    const body = await response.json() as { virtualXrp?: number };
    if (typeof body.virtualXrp === 'number' && Number.isFinite(body.virtualXrp)) applyStake(body.virtualXrp);
  }, [applyStake]);
  function setVirtualXrp(amount: number) {
    const next = Number.isFinite(amount) && amount > 0 ? amount : 200;
    applyStake(next);
    void fetch('/api/trading/virtual-stake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ virtualXrp: next }),
    }).then(() => refreshStake());
  }
  useEffect(() => {
    void refreshStake();
    const timer = window.setInterval(() => { void refreshStake(); }, 4_000);
    return () => window.clearInterval(timer);
  }, [refreshStake]);
  return <DeskMarketContext.Provider value={{ symbol, setSymbol, ticker: stream.ticker, state: stream.state, virtualXrp, setVirtualXrp, refreshStake }}>{children}</DeskMarketContext.Provider>;
}
function priceDigits(symbol: string) {
  const quote = symbol.split('/')[1];
  return quote === 'BTC' || quote === 'ETH' ? 8 : 4;
}
function readableError(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) return null;
  const cleaned = String((error as { message: unknown }).message).replace(/^HTTP \d+\s+[^:]*:\s*/, '');
  return cleaned || null;
}
function compact(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (values.length < 2) return <svg viewBox="0 0 88 32" className="h-8 w-24" aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 88},${28 - ((v - min) / range) * 22}`).join(' ');
  return <svg viewBox="0 0 88 32" className="h-8 w-24" aria-hidden="true"><polyline points={pts} fill="none" stroke={positive ? '#16a34a' : '#ef4444'} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
function CandleChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return <div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">No candle data returned for this interval.</div>;
  const priceH = 74;
  const volTop = 80;
  const volH = 16;
  const min = Math.min(...candles.map(c => c.low));
  const max = Math.max(...candles.map(c => c.high));
  const range = max - min || 1;
  const y = (v: number) => ((max - v) / range) * priceH;
  const step = 100 / candles.length;
  const smaPeriod = 20;
  let rolling = 0;
  const sma: string[] = [];
  candles.forEach((candle, i) => {
    rolling += candle.close;
    if (i >= smaPeriod) rolling -= candles[i - smaPeriod].close;
    if (i >= smaPeriod - 1) sma.push(`${i * step + step / 2},${y(rolling / smaPeriod)}`);
  });
  const maxVol = Math.max(...candles.map(c => c.volume)) || 1;
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[320px] w-full" role="img" aria-label="XRP candlestick chart">
    {[0.25, 0.5, 0.75].map(p => <line key={p} x1="0" x2="100" y1={p * priceH} y2={p * priceH} stroke="#E7EDF5" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />)}
    {candles.map((c, i) => {
      const up = c.close >= c.open;
      const color = up ? '#16a34a' : '#ef4444';
      const x = i * step + step / 2;
      const bodyTop = y(Math.max(c.open, c.close));
      const bodyBot = y(Math.min(c.open, c.close));
      return <g key={`${i}-${String(c.time)}`}>
        <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <rect x={x - step * 0.28} y={bodyTop} width={Math.max(step * 0.56, 0.35)} height={Math.max(bodyBot - bodyTop, 0.35)} fill={color} />
        <rect x={x - step * 0.28} y={volTop + volH - (c.volume / maxVol) * volH} width={Math.max(step * 0.56, 0.35)} height={(c.volume / maxVol) * volH} fill={up ? '#86efac' : '#fecaca'} />
      </g>;
    })}
    <polyline points={sma.join(' ')} fill="none" stroke="#7c3aed" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
  </svg>;
}
function AreaChart({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="flex h-[150px] items-center justify-center text-xs text-muted-foreground">Not enough points for this window.</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${88 - ((v - min) / range) * 78}`).join(' ');
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[160px] w-full" role="img" aria-label="Performance chart">
    <defs><linearGradient id="perf-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity="0.28" /><stop offset="100%" stopColor="#16a34a" stopOpacity="0" /></linearGradient></defs>
    <polygon points={`0,100 ${pts} 100,100`} fill="url(#perf-fill)" />
    <polyline points={pts} fill="none" stroke="#16a34a" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
  </svg>;
}
function windowStats(values: number[]) {
  if (values.length < 2) return { ret: 0, drawdown: 0, sharpe: 0 };
  const first = values[0];
  const last = values[values.length - 1];
  let peak = values[0];
  let drawdown = 0;
  const returns: number[] = [];
  values.forEach((value, i) => {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.max(drawdown, (peak - value) / peak * 100);
    if (i > 0 && values[i - 1] > 0) returns.push((value - values[i - 1]) / values[i - 1]);
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / (returns.length || 1);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length || 1);
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(returns.length) : 0;
  return { ret: first > 0 ? ((last - first) / first) * 100 : 0, drawdown, sharpe };
}

const HERO_PHOTO = 'https://images.unsplash.com/photo-1640340434855-6084b1f4901c?auto=format&fit=crop&w=2000&q=70';
const CTA_PHOTO = 'https://images.unsplash.com/photo-1644088379091-d574269d422f?auto=format&fit=crop&w=2000&q=70';
const LANDING_FEATURES = [
  { icon: Activity, title: 'Live Binance price', body: 'Every page reads the same streaming quote, with its freshness on display.' },
  { icon: Receipt, title: 'Paper receipts', body: 'Each fill shows price, fee and slippage, then lands in your profit and loss.' },
  { icon: Bot, title: 'Auto strategy', body: 'A rule engine checks the market every 15 seconds inside hard risk limits.' },
  { icon: Sparkles, title: 'AI analysis', body: 'A briefing reads the tape, news and sentiment, then calls buy, sell or wait.' },
  { icon: Send, title: 'Telegram desk', body: 'Buy, close and run auto trade from chat, with a desk snapshot every 30 minutes.' },
  { icon: Wallet, title: 'Your XRP wallet', body: 'Real XRP moves only from your own wallet, after a ledger check.' },
];
const LANDING_STEPS = [
  { n: '01', icon: BarChart3, title: 'Read the market', body: 'Live ticker and candles across four XRP pairs, with stale quotes flagged.' },
  { n: '02', icon: SlidersHorizontal, title: 'Set hard limits', body: 'Position size, daily loss and drawdown caps stop the engine for you.' },
  { n: '03', icon: FileChartColumn, title: 'Test on paper', body: 'Backtest from your stake, then run it live on paper and compare the receipts.' },
];
const LANDING_GAMES = [
  { icon: Printer, title: 'Stamp Chase', body: 'Tear the receipt before the stamp lands. The multiplier climbs toward 25x.', tone: 'from-amber-400/30 to-orange-500/10', ring: 'text-amber-300' },
  { icon: Coins, title: 'Coin Run', body: 'Help Pip the shrimp jump across 12 beats and scoop every coin.', tone: 'from-emerald-400/30 to-teal-500/10', ring: 'text-emerald-300' },
  { icon: Target, title: 'Game room', body: 'Join a 10 to 100 tank arena. Break a tank and take its entry.', tone: 'from-sky-400/30 to-indigo-500/10', ring: 'text-sky-300' },
];

function useScrollReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach(node => node.classList.add('is-in'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}
function HeroChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return <div className="flex h-full items-center justify-center text-xs text-white/50">No candle data returned for this interval.</div>;
  const closes = candles.map(c => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const yOf = (v: number) => 56 - ((v - min) / range) * 48;
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * 100},${yOf(v)}`).join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? '#34d399' : '#f87171';
  return <div className="relative h-full w-full">
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="chart-draw h-full w-full overflow-visible" role="img" aria-label="XRP close price chart">
      <defs><linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity=".34" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      {[15, 30, 45].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgb(255 255 255 / .07)" strokeDasharray="1.5 2" vectorEffect="non-scaling-stroke" />)}
      <polygon points={`0,60 ${pts} 100,60`} fill="url(#hero-fill)" />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="live-dot absolute right-0 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full" style={{ top: `${(yOf(closes[closes.length - 1]) / 60) * 100}%`, color: stroke, background: stroke }} />
  </div>;
}
function Home() {
  const { signIn } = useSession();
  const tickerParams = { symbol: 'XRP/USDT' };
  const ticker = useGetMarketTicker(tickerParams, { query: { queryKey: getGetMarketTickerQueryKey(tickerParams), refetchInterval: 30_000 } });
  const readiness = useGetReadiness();
  const [interval, setInterval] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
  const chartParams = { symbol: 'XRP/USDT', interval, limit: 120 };
  const chartQuery = useGetMarketOhlcv(chartParams, { query: { queryKey: getGetMarketOhlcvQueryKey(chartParams), refetchInterval: 60_000 } });
  const stream = useMarketStream('XRP/USDT', ticker.data);
  const market = stream.ticker;
  const bars = chartQuery.data ?? [];
  const ready = readiness.data?.status === 'ready';
  const up = (market?.changePct24h ?? 0) >= 0;
  const live = Boolean(market) && !market?.stale && stream.state === 'live';
  const [scrolled, setScrolled] = useState(false);
  useScrollReveal();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const tape: Array<[string, string, 'up' | 'down' | 'plain']> = [
    ['XRP/USDT', market ? `$${fmt(market.price, 4)}` : '—', 'plain'],
    ['24h', market ? percent(market.changePct24h) : '—', up ? 'up' : 'down'],
    ['High', market ? `$${fmt(market.high24h, 4)}` : '—', 'plain'],
    ['Low', market ? `$${fmt(market.low24h, 4)}` : '—', 'plain'],
    ['Volume', market ? compact(market.volume24h) : '—', 'plain'],
    ['Feed', market?.exchange ?? 'Exchange', 'plain'],
    ['Paper fee', '0.10%', 'plain'],
    ['Slippage', '0.05%', 'plain'],
    ['Virtual stake', '200 XRP', 'up'],
    ['Telegram', '30 min snapshots', 'plain'],
  ];
  const navLink = 'rounded-md px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:text-white';
  return <div className="min-h-[100dvh] bg-background">
    <header className={cx('fixed inset-x-0 top-0 z-40 transition-all duration-300', scrolled ? 'border-b border-white/10 bg-[#070D1A]/80 backdrop-blur-xl' : 'bg-transparent')}>
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-9">
        <Link href="/" className="flex items-center gap-2.5 text-white" data-testid="link-brand-home"><BrandMark /><span className="text-[15px] font-bold tracking-[-.03em]">XRP TradeBot</span></Link>
        <nav className="hidden items-center gap-1 md:flex"><a href="#features" className={navLink}>Features</a><a href="#method" className={navLink}>How it works</a><a href="#play" className={navLink}>Play</a><a href="#market" className={navLink}>Market</a></nav>
        <div className="flex items-center gap-2"><Link href="/sign-in" className="rounded-md px-3 py-2 text-xs font-semibold text-white/75 hover:text-white" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="btn-glow inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-create-account">Create account <ArrowRight size={13} /></Link></div>
      </div>
    </header>

    <section className="landing-dark relative overflow-hidden">
      <div className="landing-photo pointer-events-none" style={{ backgroundImage: `url(${HERO_PHOTO})` }} aria-hidden="true" />
      <div className="landing-veil pointer-events-none absolute inset-0" />
      <div className="aurora aurora-a pointer-events-none" />
      <div className="aurora aurora-b pointer-events-none" />
      <div className="landing-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-[1280px] gap-12 px-5 pb-20 pt-32 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-9 md:pb-28 md:pt-40">
        <div>
          <div className="reveal glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-emerald-200"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400 text-emerald-400" />{live ? 'Live XRP market' : 'Connecting to the XRP market'}</div>
          <h1 className="reveal max-w-[680px] font-display text-[46px] font-semibold leading-[0.98] tracking-[-.06em] sm:text-[62px] md:text-[76px]" style={{ animationDelay: '80ms' }}>Trade XRP on paper.<br /><span className="text-shine">Keep every receipt.</span></h1>
          <p className="reveal mt-6 max-w-[520px] text-[15px] leading-7 text-white/70" style={{ animationDelay: '160ms' }}>Live Binance prices, honest fills with fee and slippage, and a 200 XRP virtual stake to practise with. Your real XRP stays in your own wallet.</p>
          <div className="reveal mt-8 flex flex-wrap gap-3" style={{ animationDelay: '240ms' }}>
            <button type="button" onClick={signIn} className="btn-glow inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-start-evaluation">Open the paper desk <ArrowRight size={16} /></button>
            <a href="#features" className="glass inline-flex min-h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white transition-colors hover:bg-white/15">Explore the desk <ArrowDownRight size={15} /></a>
          </div>
          <div className="reveal mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-white/60" style={{ animationDelay: '320ms' }}>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400" />Paper execution</span>
            <span className="inline-flex items-center gap-1.5"><Receipt size={14} className="text-emerald-400" />Receipt on every fill</span>
            <span className="inline-flex items-center gap-1.5"><LockKeyhole size={14} className="text-emerald-400" />Seed phrase stays with you</span>
          </div>
        </div>

        <div className="reveal relative" style={{ animationDelay: '200ms' }}>
          <div className="float-slower glass absolute -left-4 -top-6 z-10 hidden items-center gap-2.5 rounded-xl px-3.5 py-2.5 shadow-2xl sm:flex"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300"><Wallet size={15} /></span><div><p className="text-[10px] uppercase tracking-[.12em] text-white/50">Virtual stake</p><p className="font-mono-data text-sm font-semibold">200.00 XRP</p></div></div>
          <div className="float-slow glass relative overflow-hidden rounded-2xl shadow-[0_40px_100px_-40px_rgb(16_185_129_/_.55)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300"><TrendingUp size={15} /></span><div><p className="text-xs font-semibold">XRP / USDT</p><p className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-white/45">{market?.exchange ?? 'Exchange ticker'}</p></div></div>
              <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.08em]', live ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{market?.stale ? 'Stale' : stream.state === 'live' ? 'Streaming' : 'Reconnecting'}</span>
            </div>
            <div className="px-5 pb-5 pt-5">
              <div className="flex items-end justify-between gap-3">
                <div><p className="text-[10px] uppercase tracking-[.12em] text-white/45">Last price</p><p className="mt-1 font-mono-data text-[34px] font-medium leading-none tracking-[-.04em]">{market ? `$${fmt(market.price, 4)}` : ticker.isLoading ? 'Loading' : '—'}</p></div>
                <p className={cx('rounded-lg px-2 py-1 font-mono-data text-sm font-semibold', up ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300')}>{market ? percent(market.changePct24h) : '—'} <span className="text-[10px] font-normal text-white/50">24H</span></p>
              </div>
              <div className="mt-5 flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">{(['15m', '1h', '4h', '1d'] as const).map(item => <button key={item} type="button" onClick={() => setInterval(item)} className={cx('flex-1 rounded-md px-3 py-1.5 font-mono-data text-[11px] transition-colors', interval === item ? 'bg-primary text-primary-foreground shadow' : 'text-white/60 hover:bg-white/10 hover:text-white')} data-testid={`button-interval-${item}`}>{item}</button>)}</div>
              <div key={interval} className="mt-4 h-[180px]">{chartQuery.isLoading ? <div className="h-full w-full animate-pulse rounded-lg bg-white/5" /> : chartQuery.isError ? <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-white/60">Could not load candles.<button type="button" onClick={() => chartQuery.refetch()} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-white hover:bg-white/10"><RefreshCw size={12} />Try again</button></div> : <HeroChart candles={bars} />}</div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">{[['24h high', market ? `$${fmt(market.high24h, 4)}` : '—'], ['24h low', market ? `$${fmt(market.low24h, 4)}` : '—'], ['24h volume', market ? compact(market.volume24h) : '—']].map(([label, value]) => <div key={label}><p className="text-[10px] uppercase tracking-[.12em] text-white/45">{label}</p><p className="mt-1 font-mono-data text-xs">{value}</p></div>)}</div>
              {market?.stale && <p className="mt-3 rounded-md border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">The exchange marked this quote stale. Treat it as delayed.</p>}
            </div>
          </div>
          <div className="float-slow glass absolute -bottom-7 -right-3 z-10 hidden items-center gap-2.5 rounded-xl px-3.5 py-2.5 shadow-2xl sm:flex" style={{ animationDelay: '-2s' }}><span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-400/15 text-sky-300"><Receipt size={15} /></span><div><p className="text-[10px] uppercase tracking-[.12em] text-white/50">Paper fill</p><p className="font-mono-data text-xs font-semibold">fee 0.10% · slip 0.05%</p></div></div>
        </div>
      </div>
      <a href="#market" className="scroll-cue relative mx-auto mb-6 hidden h-9 w-6 justify-center rounded-full border border-white/25 pt-2 md:flex" aria-label="Scroll to the market tape"><span className="h-2 w-1 rounded-full bg-white/70" /></a>
      <div id="market" className="marquee-wrap relative overflow-hidden border-y border-white/10 bg-white/[.03] py-3.5">
        <div className="marquee">{[0, 1].map(copy => <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>{tape.map(([label, value, tone]) => <span key={`${copy}-${label}`} className="mx-6 inline-flex items-center gap-2 whitespace-nowrap text-xs"><span className="text-white/45">{label}</span><span className={cx('font-mono-data font-semibold', tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-red-300' : 'text-white')}>{value}</span><span className="ml-6 h-1 w-1 rounded-full bg-white/20" /></span>)}</div>)}</div>
      </div>
    </section>

    <section className="relative">
      <div className="desk-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1280px] px-5 md:px-9">
        <div className="-mt-px grid grid-cols-2 gap-4 py-14 md:grid-cols-4">{[['200 XRP', 'Starting virtual stake'], ['0.15%', 'Fee plus slippage per fill'], ['15 s', 'Auto engine check'], ['4 pairs', 'USDT, USDC, BTC and ETH']].map(([value, label], i) => <div key={label} data-reveal style={{ '--d': `${i * 80}ms` } as CSSProperties} className="panel lift px-5 py-5"><p className="font-display text-[30px] font-semibold leading-none tracking-[-.04em] text-primary">{value}</p><p className="mt-2 text-xs text-muted-foreground">{label}</p></div>)}</div>

        <div id="features" className="scroll-mt-20 pb-16 md:pb-24">
          <div data-reveal className="mx-auto max-w-2xl text-center"><div className="eyebrow">Everything on one desk</div><h2 className="mt-3 font-display text-[34px] font-semibold tracking-[-.045em] md:text-[44px]">Built for calm, honest practice.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">One live price feeds the chart, the paper fills, the AI briefing and your Telegram bot, so every number agrees.</p></div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{LANDING_FEATURES.map((item, i) => <div key={item.title} data-reveal style={{ '--d': `${(i % 3) * 90}ms` } as CSSProperties} className="panel lift group p-6"><span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"><item.icon size={19} /></span><h3 className="mt-5 text-[15px] font-semibold tracking-[-.015em]">{item.title}</h3><p className="mt-2 text-[13px] leading-6 text-muted-foreground">{item.body}</p></div>)}</div>
        </div>

        <div id="method" className="scroll-mt-20 grid gap-10 border-t border-border py-16 md:grid-cols-[.75fr_1.25fr] md:py-24">
          <div data-reveal><div className="eyebrow">How it works</div><h2 className="mt-3 max-w-sm font-display text-[34px] font-semibold tracking-[-.045em]">Evidence before exposure.</h2><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Every signal, risk decision and paper fill stays visible. A strategy earns its place one receipt at a time.</p><button type="button" onClick={signIn} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:gap-3 transition-all">Start with 200 XRP <ArrowRight size={15} /></button></div>
          <div className="relative grid gap-4 sm:grid-cols-3">
            <div className="pointer-events-none absolute left-8 right-8 top-[38px] hidden h-px bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0 sm:block" />
            {LANDING_STEPS.map((item, i) => <div key={item.n} data-reveal style={{ '--d': `${i * 120}ms` } as CSSProperties} className="panel lift relative p-5"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-full bg-primary font-mono-data text-xs font-semibold text-primary-foreground shadow-[0_0_0_6px_hsl(142_60%_94%)]">{item.n}</span><item.icon size={17} className="text-muted-foreground" /></div><h3 className="mt-6 text-sm font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.body}</p></div>)}
          </div>
        </div>
      </div>
    </section>

    <section id="play" className="landing-dark relative scroll-mt-16 overflow-hidden py-20 md:py-28">
      <div className="aurora aurora-c pointer-events-none" />
      <div className="landing-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1280px] px-5 md:px-9">
        <div data-reveal className="flex flex-wrap items-end justify-between gap-4"><div><div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-emerald-300"><Gamepad2 size={14} />Play</div><h2 className="mt-3 max-w-lg font-display text-[34px] font-semibold tracking-[-.045em] md:text-[44px]">Take a break between candles.</h2><p className="mt-3 max-w-lg text-sm leading-6 text-white/60">Three quick games played with your virtual XRP stake. Wins and losses settle on the same stake the desk shows.</p></div><button type="button" onClick={signIn} className="glass inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition-colors hover:bg-white/15">Open the arcade <ArrowUpRight size={15} /></button></div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">{LANDING_GAMES.map((game, i) => <div key={game.title} data-reveal style={{ '--d': `${i * 110}ms` } as CSSProperties} className="glass group relative overflow-hidden rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1.5">
          <div className={cx('pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br blur-2xl transition-transform duration-500 group-hover:scale-125', game.tone)} />
          <span className={cx('relative grid h-12 w-12 place-items-center rounded-xl bg-white/10', game.ring)}><game.icon size={22} /></span>
          <h3 className="relative mt-6 font-display text-xl font-semibold tracking-[-.03em]">{game.title}</h3>
          <p className="relative mt-2 text-[13px] leading-6 text-white/60">{game.body}</p>
          <p className="relative mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 transition-all group-hover:gap-2.5">Play with virtual XRP <ArrowRight size={13} /></p>
        </div>)}</div>
      </div>
    </section>

    <section className="relative overflow-hidden bg-[#070D1A] text-white">
      <div className="landing-photo pointer-events-none opacity-40" style={{ backgroundImage: `url(${CTA_PHOTO})`, backgroundPosition: 'center 60%' }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#070D1A] via-[#070D1A]/80 to-[#070D1A]/40" />
      <div data-reveal className="relative mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-8 px-5 py-20 md:px-9">
        <div><h2 className="max-w-xl font-display text-[34px] font-semibold leading-tight tracking-[-.045em] md:text-[46px]">Start with <span className="text-shine">200 virtual XRP</span>.</h2><p className="mt-3 max-w-md text-sm leading-6 text-white/65">Open the desk, place a paper trade on the live price, and read the receipt. It takes under a minute.</p></div>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={signIn} className="btn-glow inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Open the paper desk <ArrowRight size={16} /></button><Link href="/sign-in" className="glass inline-flex min-h-12 items-center rounded-xl px-6 text-sm font-semibold text-white hover:bg-white/15">Sign in</Link></div>
      </div>
      <footer className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[11px] text-white/50 md:px-9">
          <span className="flex items-center gap-2"><BrandMark inverted /><span>© XRP TradeBot · Paper execution desk</span></span>
          <span className="flex items-center gap-4"><span className="inline-flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-400' : 'bg-amber-400')} />Market data {readiness.data?.marketData ?? 'checking'}</span><span>Photos: Unsplash</span></span>
        </div>
      </footer>
    </section>
  </div>;
}

function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return <span className={cx('grid h-9 w-9 place-items-center rounded-xl', inverted ? 'bg-white text-[#0B1220]' : 'bg-primary text-white')}><svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></span>;
}
function PortalShell({ children }: { children: ReactNode }) {
  return <DeskMarketProvider><PortalChrome>{children}</PortalChrome></DeskMarketProvider>;
}
function PortalChrome({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut, user, switchUser } = useSession();
  const market = useDeskMarket();
  const readiness = useGetReadiness();
  const signals = useGetSignals({ limit: 20 }, { query: { queryKey: getGetSignalsQueryKey({ limit: 20 }), refetchInterval: 30_000 } });
  const [menu, setMenu] = useState<'pair' | 'quote' | 'alerts' | 'account' | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const ticker = market.ticker;
  const digits = priceDigits(market.symbol);
  const [base, quote] = market.symbol.split('/');
  const up = (ticker?.changePct24h ?? 0) >= 0;
  const recentSignals = signals.data ?? [];
  const tradeAlerts = useTradeAlerts(market.symbol, market.ticker, recentSignals);
  const noteCount = recentSignals.filter(signal => Date.now() - new Date(signal.createdAt).getTime() < 86_400_000).length;
  const online = readiness.data?.status === 'ready';
  useEffect(() => { setMenu(null); }, [location]);
  useEffect(() => {
    if (!menu) return;
    function onPointer(event: MouseEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setMenu(null); }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  function toggleMenu(next: 'pair' | 'quote' | 'alerts' | 'account') {
    setMenu(current => current === next ? null : next);
  }
  function jumpTo(id: 'desk-chart' | 'trading') {
    setMenu(null);
    setMobileOpen(false);
    if (location !== '/user-portal') {
      sessionStorage.setItem(id === 'trading' ? 'xrpq-scroll-trading' : 'xrpq-scroll-chart', '1');
      setLocation('/user-portal');
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openTrading(event: { preventDefault: () => void }) {
    event.preventDefault();
    setMobileOpen(false);
    if (location !== '/user-portal') {
      sessionStorage.setItem('xrpq-scroll-trading', '1');
      setLocation('/user-portal');
      return;
    }
    document.getElementById('trading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return <div className="min-h-[100dvh] bg-background">
    {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[#0B1220]/40 md:hidden" onClick={() => setMobileOpen(false)} />}
    <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col bg-[#0B1220] text-white transition-transform duration-200 md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex h-16 items-center justify-between px-5"><Link href="/user-portal" className="flex items-center gap-2.5" data-testid="link-sidebar-home"><BrandMark inverted /><span className="leading-tight"><span className="block text-sm font-bold tracking-[-.03em]">XRP TradeBot</span><span className="block text-[10px] text-white/45">Automate · Analyze · Trade</span></span></Link><button className="text-white/70 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={16} /></button></div>
      <nav className="mt-1 min-h-0 flex-1 overflow-y-auto px-3 pb-4">{navGroups.map(group => <div key={group.label}><p className="nav-label">{group.label}</p><div className="space-y-0.5">{group.items.map(item => {
        const Icon = item.icon;
        const path = item.path.split('#')[0];
        const hash = item.path.includes('#');
        const active = !hash && location === path;
        return <Link key={item.label} href={path} onClick={hash ? openTrading : () => setMobileOpen(false)} className={cx('flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors', active ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#34d399]' : 'text-white/65 hover:bg-white/5 hover:text-white')} data-testid={`nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} />{item.label}{item.path === '/notifications' && noteCount > 0 && <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{noteCount > 9 ? '9+' : noteCount}</span>}{item.path === '/analysis' && tradeAlerts.briefing?.action.allowed && <span className={cx('ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase', tradeAlerts.briefing.action.side === 'sell' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-400/20 text-emerald-300')}>{tradeAlerts.briefing.action.side}</span>}
              {item.path === '/analysis' && tradeAlerts.briefing?.verdict === 'ready' && !tradeAlerts.briefing.action.allowed && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />}</Link>;
      })}</div></div>)}</nav>
      <div className="mt-auto border-t border-white/10 p-4">
        <button onClick={signOut} className="mb-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-white/55 hover:bg-white/5 hover:text-white" data-testid="button-sign-out"><LogOut size={14} />Sign out</button>
        <div className="flex items-center gap-2 px-2 text-xs"><span className={cx('h-2 w-2 rounded-full', online ? 'bg-emerald-400' : 'bg-amber-400')} /><span>{online ? 'System Online' : 'System Attention'}</span><span className="ml-auto text-[10px] text-white/35">v1.0.0</span></div>
      </div>
    </aside>
    <div className="min-h-[100dvh] md:pl-[240px]">
      <header ref={headerRef} className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border bg-white px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={16} /></button>
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu === 'pair'} onClick={() => toggleMenu('pair')} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-muted" data-testid="button-header-pair"><span className="text-primary">{base}</span><span className="text-muted-foreground">/</span>{quote}<ChevronDown size={14} className="text-muted-foreground" /></button>
            {menu === 'pair' && <div role="menu" className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-border bg-white p-1 shadow-lg">
              <p className="px-3 py-2 text-[11px] text-muted-foreground">Chart pair. Paper orders still use the strategy symbol.</p>
              {DESK_PAIRS.map(pair => <button key={pair} type="button" role="menuitem" onClick={() => { market.setSymbol(pair); setMenu(null); }} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-muted', market.symbol === pair && 'bg-accent text-accent-foreground')} data-testid={`button-pair-${pair.replace('/', '-')}`}>{pair}{market.symbol === pair && <Check size={14} />}</button>)}
            </div>}
          </div>
          <button type="button" onClick={() => jumpTo('desk-chart')} className="hidden items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 hover:bg-muted sm:flex" data-testid="button-header-price" title="Open the chart"><span className="font-mono-data text-sm font-semibold">{ticker ? fmt(ticker.price, digits) : '—'}</span><span className={cx('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{ticker ? percent(ticker.changePct24h) : ''}</span></button>
          <div className="flex items-center gap-2 rounded-full bg-[#0B1220] px-3 py-1.5 text-white" data-testid="text-header-xrp" title="A trade lowers this stake. A win raises it."><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-200">Virtual</span><span className="font-mono-data text-sm font-semibold">{fmt(market.virtualXrp, 2)} XRP</span></div>
          <div className="relative hidden lg:block">
            <button type="button" aria-haspopup="menu" aria-expanded={menu === 'quote'} onClick={() => toggleMenu('quote')} className="flex items-center gap-5 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted" data-testid="button-header-stats"><span>24h High <b className="ml-1 font-mono-data font-medium text-foreground">{ticker ? fmt(ticker.high24h, digits) : '—'}</b></span><span>24h Low <b className="ml-1 font-mono-data font-medium text-foreground">{ticker ? fmt(ticker.low24h, digits) : '—'}</b></span><span>24h Vol <b className="ml-1 font-mono-data font-medium text-foreground">{ticker ? compact(ticker.volume24h) : '—'}</b></span><ChevronDown size={12} /></button>
            {menu === 'quote' && <div role="menu" className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-white p-3 shadow-lg">
              <p className="text-sm font-semibold">{market.symbol}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{ticker?.exchange ?? 'Exchange'} · {market.state === 'live' ? 'Streaming' : 'Reconnecting'} · updated {dateTime(ticker?.updatedAt)}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><div><p className="text-muted-foreground">24h high</p><p className="font-mono-data font-medium">{ticker ? fmt(ticker.high24h, digits) : '—'}</p></div><div><p className="text-muted-foreground">24h low</p><p className="font-mono-data font-medium">{ticker ? fmt(ticker.low24h, digits) : '—'}</p></div><div><p className="text-muted-foreground">24h move</p><p className="font-mono-data font-medium">{ticker ? fmt(ticker.change24h, digits) : '—'}</p></div></div>
              {ticker?.stale && <p className="mt-2 text-[11px] text-amber-700">This quote is marked stale.</p>}
              <button type="button" onClick={() => jumpTo('desk-chart')} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">Open chart</button>
            </div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu === 'alerts'} onClick={() => toggleMenu('alerts')} className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Open notifications" data-testid="button-header-alerts"><Bell size={16} />{noteCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />}</button>
            {menu === 'alerts' && <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-border bg-white shadow-lg">
              <div className="flex items-center justify-between border-b border-border px-3 py-2"><p className="text-sm font-semibold">Notifications</p><Link href="/notifications" onClick={() => setMenu(null)} className="text-xs font-semibold text-primary">View all</Link></div>
              <Link href="/analysis" onClick={() => setMenu(null)} className="block border-b border-border px-3 py-2.5 hover:bg-muted"><p className="text-xs font-semibold">{tradeAlerts.briefing?.action.headline ?? 'Checking the start conditions'}</p><p className="mt-1 text-[11px] text-muted-foreground">{tradeAlerts.briefing?.headline ?? 'The call stays on the desk line.'}</p></Link>
              <Link href="/telegram" onClick={() => setMenu(null)} className="block border-b border-border px-3 py-2.5 text-xs font-semibold hover:bg-muted">Telegram alarms</Link>
              <div className="max-h-72 overflow-y-auto">{recentSignals.length ? recentSignals.slice(0, 6).map(signal => <Link key={signal.id} href="/notifications" onClick={() => setMenu(null)} className="block border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{signal.side.toUpperCase()} · {signal.symbol}</span><span className="text-[10px] text-muted-foreground">{dateTime(String(signal.createdAt))}</span></div><p className="mt-1 truncate text-[11px] text-muted-foreground">{signal.rejectionReason ?? signal.message}</p></Link>) : <p className="px-3 py-6 text-center text-xs text-muted-foreground">No signals yet. They appear here when the paper engine evaluates a strategy.</p>}</div>
            </div>}
          </div>
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu === 'account'} onClick={() => toggleMenu('account')} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-muted" data-testid="button-header-account">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0B1220] text-[11px] font-bold text-white">{user.initial}</span>
              <span className="hidden text-sm font-semibold sm:block">{user.firstName}</span>
              <ChevronDown size={14} className="hidden text-muted-foreground sm:block" />
            </button>
            {menu === 'account' && <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-border bg-white p-1 shadow-lg">
              <div className="border-b border-border px-3 py-2"><p className="text-sm font-semibold">{user.firstName}</p><p className="truncate text-[11px] text-muted-foreground">{user.email}</p></div>
              <Link href="/user-portal" onClick={() => setMenu(null)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><LayoutDashboard size={14} />Dashboard</Link>
              <Link href="/analysis" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><Sparkles size={14} />AI analysis</Link>
              <Link href="/telegram" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><Send size={14} />Telegram</Link>
              <Link href="/demo" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><FlaskConical size={14} />Demo</Link>
              <Link href="/settings" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><Settings2 size={14} />Settings</Link>
              <Link href="/xrp-wallet" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><ArrowUpRight size={14} />XRP wallet</Link>
              <Link href="/activity" onClick={() => setMenu(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"><History size={14} />Trade history</Link>
              {switchUser && <button type="button" onClick={() => { setMenu(null); switchUser(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" data-testid="button-header-switch-user"><RefreshCw size={14} />Switch user</button>}
              <button type="button" onClick={() => { setMenu(null); signOut(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50" data-testid="button-header-sign-out"><LogOut size={14} />Sign out</button>
            </div>}
          </div>
        </div>
      </header>
      <Link href="/analysis" className="desk-call px-4 text-xs md:px-6" data-testid="status-trade-call">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', tradeAlerts.briefing?.verdict === 'ready' ? 'bg-emerald-500' : tradeAlerts.briefing?.verdict === 'blocked' ? 'bg-red-500' : 'bg-amber-400')} />
        <span className="shrink-0 font-semibold">{tradeAlerts.briefing?.action.headline ?? 'Checking the start conditions'}</span>
        <span className="min-w-0 truncate text-muted-foreground">{tradeAlerts.briefing?.headline ?? 'The call stays on this line and refreshes about once a minute.'}</span>
        <span className="ml-auto shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm">Analysis</span>
      </Link>
      <main className="page-enter mx-auto max-w-[1440px] px-4 py-5 md:px-6 md:py-6">{children}</main>
    </div>
  </div>;
}
function HomeRedirect() {
  const { signedIn } = useSession();
  return signedIn ? <Redirect to="/user-portal" /> : <Home />;
}
function Guard({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  return signedIn ? <>{children}</> : <Redirect to="/" />;
}
function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10"><div className="desk-grid pointer-events-none absolute inset-0" /><div className="relative w-full"><div className="mb-5 text-center"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold"><BrandMark />XRP TradeBot</Link></div>{children}</div></div>;
}
function LocalAuthCard({ title, detail }: { title: string; detail: string }) {
  const demo = useContext(DemoProfilesContext);
  const [loginId, setLoginId] = useState('');
  const [touched, setTouched] = useState(false);
  if (!demo) return null;
  const valid = LOGIN_ID_PATTERN.test(loginId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (valid) demo.login(loginId);
  };
  return <Panel className="mx-auto w-full max-w-[420px] overflow-hidden">
    <form onSubmit={submit} className="p-6">
      <p className="eyebrow">Local workspace</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      <label className="mt-5 block text-xs font-semibold" htmlFor="login-id">Your ID</label>
      <input id="login-id" autoFocus autoComplete="username" spellCheck={false} value={loginId} onChange={event => setLoginId(normalizeLoginId(event.target.value))} placeholder="e.g. ben" className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 font-mono text-sm outline-none focus:border-primary" data-testid="input-login-id" />
      <p className={`mt-1.5 text-[11px] ${touched && !valid ? 'text-destructive' : 'text-muted-foreground'}`}>3 to 24 characters: letters, numbers or dashes. No password needed.</p>
      <Button type="submit" className="mt-4 w-full" disabled={!loginId} data-testid="button-login">Log in</Button>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">A new ID opens a new paper account with 200 virtual XRP. The same ID always opens the same account. Your existing account is <span className="font-mono">demo</span>.</p>
    </form>
    {demo.profiles.length > 0 && <div className="border-t border-border px-6 py-4">
      <p className="text-xs font-semibold">Recent on this browser</p>
      <div className="mt-2 flex flex-wrap gap-2">{demo.profiles.map(profile => <span key={profile.id} className="inline-flex items-center rounded-full border border-border bg-card text-xs transition-colors hover:border-primary/40">
        <button type="button" onClick={() => demo.enterAs(profile)} className="py-1.5 pl-3 pr-2 font-mono" data-testid={`button-enter-${profile.id}`}>{profile.id.replace(/^local-/, '')}</button>
        {profile.id !== DEFAULT_PROFILE.id && <button type="button" onClick={() => demo.remove(profile.id)} className="grid h-6 w-6 place-items-center rounded-full pr-1 text-muted-foreground hover:text-destructive" aria-label={`Remove ${profile.name} from recent`}><X size={12} /></button>}
      </span>)}</div>
    </div>}
  </Panel>;
}
function SignInPage() {
  if (demoMode) return <AuthFrame><LocalAuthCard title="Welcome back" detail="Open the local research desk. Orders stay on paper, and account state is stored in MongoDB." /></AuthFrame>;
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}
function SignUpPage() {
  if (demoMode) return <AuthFrame><LocalAuthCard title="Create your desk" detail="Start a local paper account and review XRP with the same risk controls as a signed-in workspace." /></AuthFrame>;
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}

function Overview() {
  const dashboard = useGetTradingDashboard({ query: { queryKey: getGetTradingDashboardQueryKey(), refetchInterval: 5_000 } });
  const portfolio = useGetPortfolio({ query: { queryKey: getGetPortfolioQueryKey(), refetchInterval: 5_000 } });
  const trades = useGetTrades({ limit: 100 });
  const strategies = useGetStrategies();
  const backtests = useGetBacktests();
  const validation = useGetPaperValidation();
  const market = useDeskMarket();
  const [interval, setCandleInterval] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('1h');
  const [range, setRange] = useState<'7D' | '30D' | '90D'>('7D');
  const chartParams = { symbol: market.symbol, interval, limit: 120 };
  const chart = useGetMarketOhlcv(chartParams, { query: { queryKey: getGetMarketOhlcvQueryKey(chartParams), refetchInterval: 60_000 } });
  const perfInterval = range === '90D' ? '4h' as const : '1h' as const;
  const perfLimit = range === '7D' ? 168 : range === '30D' ? 720 : 540;
  const perfParams = { symbol: market.symbol, interval: perfInterval, limit: perfLimit };
  const perf = useGetMarketOhlcv(perfParams, { query: { queryKey: getGetMarketOhlcvQueryKey(perfParams), refetchInterval: 120_000 } });
  const data = dashboard.data;
  const p = portfolio.data ?? data?.portfolio;
  const ticker = market.ticker ?? data?.ticker;
  const closes = (perf.data ?? []).map(c => c.close);
  const stats = windowStats(closes);
  const last = chart.data?.[chart.data.length - 1];
  const sortedTrades = [...(trades.data ?? data?.recentTrades ?? [])].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));
  const equityPath = sortedTrades.reduce<number[]>((points, trade) => {
    points.push((points.at(-1) ?? p?.initialBalance ?? 10000) + trade.netPnl);
    return points;
  }, p ? [p.initialBalance] : []);
  if (p) equityPath.push(p.equity);
  const pnlPath = sortedTrades.reduce<number[]>((points, trade) => {
    points.push((points.at(-1) ?? 0) + trade.netPnl);
    return points;
  }, [0]);
  const dayBasis = p ? p.equity - p.dayPnl : 0;
  const dayPct = dayBasis > 0 && p ? (p.dayPnl / dayBasis) * 100 : 0;
  const totalPnl = p ? p.realizedPnl + p.unrealizedPnl : 0;
  const active = data?.activeStrategy ?? strategies.data?.find(s => s.active);
  const priceUp = (ticker?.changePct24h ?? 0) >= 0;
  const deskReady = Boolean(data);
  const candleHigh = chart.data?.length ? Math.max(...chart.data.map(c => c.high)) : null;
  const candleLow = chart.data?.length ? Math.min(...chart.data.map(c => c.low)) : null;
  useEffect(() => {
    if (!deskReady) return;
    const target = sessionStorage.getItem('xrpq-scroll-trading') === '1' ? 'trading' : sessionStorage.getItem('xrpq-scroll-chart') === '1' ? 'desk-chart' : '';
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById(target);
      if (!node) return;
      sessionStorage.removeItem('xrpq-scroll-trading');
      sessionStorage.removeItem('xrpq-scroll-chart');
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deskReady]);
  if (dashboard.isLoading && !data) return <div className="space-y-4"><Skeleton className="h-44" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-80" /></div>;
  if (dashboard.isError && !data) return <QueryState error retry={() => void dashboard.refetch()}>{null}</QueryState>;
  return <div className="space-y-4">
    {(ticker?.stale || dashboard.isError) && <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><ShieldAlert size={14} />{ticker?.stale ? `Ticker is stale. Last update ${dateTime(ticker.updatedAt)}.` : 'Dashboard refresh failed. Showing the last successful snapshot.'}</div>}
    <section className="relative overflow-hidden rounded-3xl bg-[#0B1220] text-white">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_80%_40%,rgba(34,197,94,0.28),transparent_60%)]" />
      <div className="relative grid divide-y divide-white/10 md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="px-6 py-6 md:px-7">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-200">Live price</p>
          <p className="mt-3 font-mono-data text-4xl font-semibold tracking-[-.04em]" data-testid="text-desk-live-price">{ticker ? fmt(ticker.price, priceDigits(market.symbol)) : '—'}</p>
          <p className={cx('mt-2 text-sm font-semibold', priceUp ? 'text-emerald-300' : 'text-red-300')}>{ticker ? `${percent(ticker.changePct24h)} · ${market.symbol}` : 'Waiting for Binance'}</p>
          <p className="mt-2 text-[11px] text-white/45">{ticker?.exchange ?? 'Exchange'} · {ticker ? dateTime(ticker.updatedAt) : '—'}</p>
        </div>
        <div className="px-6 py-6 md:px-7">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-white/45">Paper result</p>
          <p className={cx('mt-3 font-display text-4xl font-semibold tracking-[-.04em]', totalPnl > 0 ? 'text-emerald-300' : totalPnl < 0 ? 'text-red-300' : 'text-white')}>{p ? money(totalPnl, p.quoteCurrency) : '—'}</p>
          <p className="mt-2 text-sm text-white/70">{p ? `${money(p.equity, p.quoteCurrency)} equity · ${p.openPositions.length} open` : 'Paper account'}</p>
          <button type="button" onClick={() => document.getElementById('trading')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="mt-4 text-xs font-semibold text-emerald-300">Place a $100 paper buy</button>
        </div>
        <div className="px-6 py-6 md:px-7">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-white/45">Real XRP</p>
          <p className="mt-3 font-display text-3xl font-semibold tracking-[-.04em]">Wallet</p>
          <p className="mt-2 text-sm leading-6 text-white/70">A payment leaves only after the ledger check and your wallet approves it.</p>
          <Link href="/xrp-wallet" className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">Open XRP wallet</Link>
        </div>
      </div>
    </section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Panel className="border-t-2 border-t-primary px-4 py-4"><p className="text-xs text-muted-foreground">Total Balance</p><div className="mt-2 flex items-end justify-between gap-3"><div><p className="font-display text-[26px] font-semibold leading-none">{p ? money(p.equity, p.quoteCurrency) : '—'}</p><p className={cx('mt-2 text-xs font-semibold', dayPct >= 0 ? 'text-emerald-600' : 'text-red-500')}>{p ? percent(dayPct) : '—'} <span className="font-normal text-muted-foreground">today</span></p></div><Sparkline values={equityPath.length > 1 ? equityPath : [p?.equity ?? 0, p?.equity ?? 0]} positive={dayPct >= 0} /></div></Panel>
      <Panel className="border-t-2 border-t-primary/70 px-4 py-4"><p className="text-xs text-muted-foreground">Total P&L</p><div className="mt-2 flex items-end justify-between gap-3"><div><p className="font-display text-[26px] font-semibold leading-none">{p ? money(totalPnl, p.quoteCurrency) : '—'}</p><p className={cx('mt-2 text-xs font-semibold', totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500')}>{p ? `${p.openPositions.length} open` : '—'}</p></div><Sparkline values={pnlPath.length > 1 ? pnlPath : [0, totalPnl]} positive={totalPnl >= 0} /></div></Panel>
      <Panel className="border-t-2 border-t-primary/50 px-4 py-4"><p className="text-xs text-muted-foreground">Total Trades</p><div className="mt-2 flex items-end justify-between gap-3"><div><p className="font-display text-[26px] font-semibold leading-none">{data ? data.stats.totalTrades : '—'}</p><p className="mt-2 text-xs text-muted-foreground">Win rate <span className="font-semibold text-foreground">{data ? `${fmt(data.stats.winRate)}%` : '—'}</span></p></div><Sparkline values={pnlPath} positive={(data?.stats.winRate ?? 0) >= 50} /></div></Panel>
      <Panel className="border-t-2 border-t-primary/30 px-4 py-4"><p className="text-xs text-muted-foreground">Active Strategy</p><div className="mt-2 flex items-end justify-between gap-3"><div><p className="font-display text-xl font-semibold leading-tight">{active?.name ?? 'None selected'}</p><p className="mt-2"><StatusPill tone={data?.trading.state === 'running' ? 'good' : 'neutral'}>{data?.trading.state ?? 'stopped'}</StatusPill></p></div><Sparkline values={closes.slice(-24)} positive={priceUp} /></div></Panel>
    </section>
    <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_340px]">
      <Panel id="desk-chart" className="scroll-mt-24 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0B1220] text-xs font-bold text-white">X</span><div><p className="text-sm font-semibold">{market.symbol}</p><p className="text-[11px] text-muted-foreground">{ticker?.exchange ?? 'Exchange'} · {interval}</p></div></div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">{(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map(item => <button key={item} onClick={() => setCandleInterval(item)} className={cx('rounded-md px-2.5 py-1 text-[11px] font-semibold', interval === item ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground')} data-testid={`button-interval-${item}`}>{item}</button>)}</div>
        </div>
        <div className="px-4 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono-data text-2xl font-semibold">{ticker ? fmt(ticker.price, priceDigits(market.symbol)) : '—'}</p><p className={cx('text-xs font-semibold', priceUp ? 'text-emerald-600' : 'text-red-500')}>{ticker ? percent(ticker.changePct24h) : '—'}</p></div>{last && <p className="font-mono-data text-[11px] text-muted-foreground">O {fmt(last.open, priceDigits(market.symbol))} · H {fmt(last.high, priceDigits(market.symbol))} · L {fmt(last.low, priceDigits(market.symbol))} · C {fmt(last.close, priceDigits(market.symbol))}</p>}</div>
          <div className="mt-2 flex gap-2">{chart.isLoading ? <Skeleton className="h-[320px] flex-1" /> : chart.isError ? <QueryState error retry={() => void chart.refetch()}>{null}</QueryState> : <><div className="min-w-0 flex-1"><CandleChart candles={chart.data ?? []} /></div>{candleHigh != null && candleLow != null && <div className="flex h-[320px] w-16 flex-col justify-between py-1 text-right font-mono-data text-[10px] text-muted-foreground"><span>{fmt(candleHigh, priceDigits(market.symbol))}</span><span>{fmt((candleHigh + candleLow) / 2, priceDigits(market.symbol))}</span><span>{fmt(candleLow, priceDigits(market.symbol))}</span></div>}</>}</div>
          <div className="flex items-center gap-4 pb-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-emerald-500" />Up</span><span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-red-500" />Down</span><span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-violet-600" />MA 20</span><span className="ml-auto">Volume</span></div>
        </div>
      </Panel>
      <TradingControl />
    </section>
    {p && p.openPositions.length > 0 && <Panel className="overflow-hidden"><div className="flex items-center justify-between px-4 py-3"><p className="text-sm font-semibold">Open positions</p></div>
      <TableWrap><TableHead><tr>{['Symbol', 'Qty', 'Entry', 'Mark', 'Unrealized', 'Stop', 'Target'].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{p.openPositions.map(position => <tr key={position.id}><td className="px-4 py-3 font-semibold">{position.symbol}</td><td className="px-4 py-3 font-mono-data">{fmt(position.quantity, 4)}</td><td className="px-4 py-3 font-mono-data">{fmt(position.entryPrice, 4)}</td><td className="px-4 py-3 font-mono-data">{fmt(position.markPrice, 4)}</td><td className="px-4 py-3"><MoneyValue value={position.unrealizedPnl} currency={p.quoteCurrency} /></td><td className="px-4 py-3 font-mono-data">{position.stopLossPrice > 0 ? fmt(position.stopLossPrice, 4) : '—'}</td><td className="px-4 py-3 font-mono-data">{position.takeProfitPrice > 0 ? fmt(position.takeProfitPrice, 4) : '—'}</td></tr>)}</tbody></TableWrap>
    </Panel>}
    <section className="grid gap-4 xl:grid-cols-2">
      <Panel className="overflow-hidden"><div className="flex items-center justify-between px-4 py-3"><div><p className="text-sm font-semibold">Performance Overview</p><p className="text-[11px] text-muted-foreground">{market.symbol} market window, not a substituted account curve</p></div><div className="flex rounded-lg bg-muted p-1">{(['7D', '30D', '90D'] as const).map(item => <button key={item} onClick={() => setRange(item)} className={cx('rounded-md px-2.5 py-1 text-[11px] font-semibold', range === item ? 'bg-primary text-white' : 'text-muted-foreground')}>{item}</button>)}</div></div>
        <div className="px-3">{perf.isLoading ? <Skeleton className="mx-2 mb-3 h-[160px]" /> : <AreaChart values={closes} />}</div>
        <div className="grid grid-cols-3 border-t border-border">{[['Total Return', closes.length > 1 ? percent(stats.ret) : '—'], ['Sharpe Ratio', closes.length > 1 ? fmt(stats.sharpe) : '—'], ['Max Drawdown', closes.length > 1 ? `${fmt(stats.drawdown)}%` : '—']].map(([label, value]) => <div key={label} className="px-4 py-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-mono-data text-sm font-semibold">{value}</p></div>)}</div>
      </Panel>
      <Panel className="overflow-hidden"><div className="flex items-center justify-between px-4 py-3"><p className="text-sm font-semibold">Recent Trades</p><Link href="/activity" className="text-xs font-semibold text-primary">View all</Link></div>
        <TableWrap><TableHead><tr>{['Time', 'Pair', 'Price', 'Side', 'Amount'].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{(data?.recentTrades ?? []).slice(0, 5).map(t => <tr key={t.id} data-testid={`row-recent-trade-${t.id}`}><td className="px-4 py-3 text-muted-foreground">{dateTime(String(t.closedAt))}</td><td className="px-4 py-3 font-semibold">{t.symbol}</td><td className="px-4 py-3 font-mono-data">{fmt(t.exitPrice, 4)}</td><td className="px-4 py-3"><StatusPill tone="bad">Sell</StatusPill></td><td className="px-4 py-3 font-mono-data">{money(t.quantity * t.exitPrice)}</td></tr>)}{!data?.recentTrades?.length && <EmptyCell colSpan={5}>No closed paper trades yet.</EmptyCell>}</tbody></TableWrap>
      </Panel>
    </section>
    <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.8fr)]">
      <Panel className="overflow-hidden"><div className="px-4 py-3"><p className="text-sm font-semibold">Strategy Performance</p><p className="text-[11px] text-muted-foreground">Latest completed backtest for each strategy</p></div>
        <TableWrap><TableHead><tr>{['Strategy', 'Total Return', 'Win Rate', 'Trades', 'Max Drawdown', 'Status'].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{(strategies.data ?? []).map(s => {
          const run = backtests.data?.find(b => b.strategyName === s.name);
          const running = data?.trading.state === 'running' && data.activeStrategy?.id === s.id;
          return <tr key={s.id}><td className="px-4 py-3 font-semibold">{s.name}</td><td className={cx('px-4 py-3 font-mono-data', run ? (run.totalReturnPct >= 0 ? 'text-emerald-600' : 'text-red-500') : '')}>{run ? percent(run.totalReturnPct) : '—'}</td><td className="px-4 py-3 font-mono-data">{run ? `${fmt(run.winRate)}%` : '—'}</td><td className="px-4 py-3 font-mono-data">{run ? run.tradeCount : '—'}</td><td className="px-4 py-3 font-mono-data">{run ? `${fmt(run.maxDrawdownPct)}%` : '—'}</td><td className="px-4 py-3"><StatusPill tone={running ? 'good' : 'neutral'}>{running ? 'Running' : 'Stopped'}</StatusPill></td></tr>;
        })}{!strategies.data?.length && <EmptyCell colSpan={6}>No strategies yet.</EmptyCell>}</tbody></TableWrap>
      </Panel>
      <div className="space-y-4">
        <Panel className="overflow-hidden"><div className="px-4 py-3"><p className="text-sm font-semibold">System Health</p></div>
          <div className="divide-y divide-border">{[
            ['Market feed', validation.data?.checks.find(c => c.id === 'market-feed')?.status ?? 'pending'],
            ['Websocket', market.state === 'live' ? 'passed' : 'pending'],
            ['Database', validation.data?.checks.find(c => c.id === 'database')?.status ?? 'pending'],
            ['Strategy engine', data?.trading.state === 'running' ? 'passed' : 'pending'],
            ['Risk limits', validation.data?.checks.find(c => c.id === 'risk-controls')?.status ?? 'pending'],
            ['Paper execution', validation.data?.checks.find(c => c.id === 'execution-mode')?.status ?? 'passed'],
          ].map(([label, status]) => <div key={label} className="flex items-center justify-between px-4 py-2.5 text-xs"><span>{label}</span><span className={cx('font-semibold', status === 'passed' ? 'text-emerald-600' : status === 'blocked' ? 'text-red-500' : 'text-amber-600')}>{status === 'passed' ? 'Online' : status === 'blocked' ? 'Blocked' : 'Standby'}</span></div>)}</div>
        </Panel>
        <Link href="/backtests" className="block overflow-hidden rounded-2xl bg-[#0B1220] p-5 text-white"><p className="text-sm font-semibold">Backtest Your Strategy</p><p className="mt-1 text-xs leading-5 text-white/65">Test a strategy on historical XRP candles before the paper engine runs it.</p><span className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold">Go to Backtesting</span></Link>
      </div>
    </section>
  </div>;
}

type PaperReceipt = {
  livePrice: number;
  fillPrice: number;
  quantity: number;
  spent: number;
  fee: number;
  slippage: number;
  virtualCost: number;
  cashLeft: number;
  quote: string;
  base: string;
};

function TradingControl() {
  const queryClient = useQueryClient();
  const market = useDeskMarket();
  const status = useGetTradingStatus();
  const strategies = useGetStrategies();
  const update = useUpdateStrategy();
  const start = useStartPaperTrading({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetTradingStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
  } } });
  const stop = useStopPaperTrading({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetTradingStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const emergency = useEmergencyStopTrading({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetTradingStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const [strategyId, setStrategyId] = useState('');
  const [paperAction, setPaperAction] = useState<'' | 'buy' | 'close'>('');
  const [paperNote, setPaperNote] = useState('');
  const [paperReceipt, setPaperReceipt] = useState<PaperReceipt | null>(null);
  const [positionPct, setPositionPct] = useState(10);
  const [stopLoss, setStopLoss] = useState(2.5);
  const [takeProfit, setTakeProfit] = useState(4);
  const selected = strategies.data?.find(s => s.id === strategyId);
  useEffect(() => {
    if (strategyId || !strategies.data?.length) return;
    setStrategyId(status.data?.activeStrategyId ?? strategies.data[0].id);
  }, [strategyId, strategies.data, status.data?.activeStrategyId]);
  useEffect(() => {
    if (!selected) return;
    setPositionPct(selected.maxPositionPct);
    setStopLoss(selected.stopLossPct);
    setTakeProfit(selected.takeProfitPct);
  }, [selected]);
  const state = status.data?.state ?? 'stopped';
  const error = readableError(start.error || stop.error || emergency.error || update.error);
  function saveRisk(patch: { maxPositionPct?: number; stopLossPct?: number; takeProfitPct?: number }) {
    if (!selected || state === 'running') return;
    if (patch.stopLossPct != null && (patch.stopLossPct <= 0 || patch.stopLossPct > 25)) return;
    if (patch.takeProfitPct != null && (patch.takeProfitPct <= 0 || patch.takeProfitPct > 100)) return;
    if (patch.maxPositionPct != null && (patch.maxPositionPct <= 0 || patch.maxPositionPct > 100)) return;
    update.mutate({ id: selected.id, data: patch });
  }
  return <Panel id="trading" className="scroll-mt-24 overflow-hidden">
    <div className="border-b border-border px-4 py-3"><p className="text-sm font-semibold">Trading Control</p><p className="text-[11px] text-muted-foreground">Live trading is disabled. Orders stay on paper.</p></div>
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 rounded-full bg-muted p-1 text-xs font-semibold"><span className="rounded-full bg-white py-2 text-center shadow-sm">Paper Trading</span><span className="py-2 text-center text-muted-foreground" title="Live exchange orders are not enabled">Live Trading</span></div>
      <label className="block space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">Strategy</span><select value={strategyId} onChange={e => setStrategyId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm" aria-label="Paper strategy" data-testid="select-paper-strategy"><option value="">Select strategy</option>{strategies.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="block space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">Trading Pair</span><div className="flex h-10 items-center rounded-lg border border-input bg-muted/40 px-3 text-sm font-semibold">{selected?.symbol ?? 'XRP/USDT'}</div></label>
      <label className="block space-y-1.5"><span className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">Position Size <span className="font-mono-data text-foreground">{fmt(positionPct, 0)}%</span></span><input type="range" min={1} max={100} value={positionPct} disabled={!selected || state === 'running'} onChange={e => setPositionPct(Number(e.target.value))} onMouseUp={e => saveRisk({ maxPositionPct: Number(e.currentTarget.value) })} onTouchEnd={e => saveRisk({ maxPositionPct: Number(e.currentTarget.value) })} className="w-full accent-emerald-600" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">Stop Loss</span><input type="number" min={0.1} max={25} step={0.1} value={stopLoss} disabled={!selected || state === 'running'} onChange={e => setStopLoss(Number(e.target.value))} onBlur={() => saveRisk({ stopLossPct: stopLoss })} className="h-10 w-full rounded-lg border border-input bg-white px-3 font-mono-data text-sm" /></label>
        <label className="space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">Take Profit</span><input type="number" min={0.01} max={100} step={0.1} value={takeProfit} disabled={!selected || state === 'running'} onChange={e => setTakeProfit(Number(e.target.value))} onBlur={() => saveRisk({ takeProfitPct: takeProfit })} className="h-10 w-full rounded-lg border border-input bg-white px-3 font-mono-data text-sm" /></label>
      </div>
      {state !== 'running' ? <Button className="h-11 w-full rounded-lg" disabled={!strategyId || start.isPending} onClick={() => start.mutate({ data: { strategyId } })} data-testid="button-start-paper">{start.isPending ? 'Starting…' : 'Start Bot'}</Button> : <Button variant="outline" className="h-11 w-full rounded-lg" disabled={stop.isPending} onClick={() => stop.mutate()} data-testid="button-stop-paper">{stop.isPending ? 'Stopping…' : 'Stop Bot'}</Button>}
      <div className="border-t border-border pt-4"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Manual paper</p><p className="mb-3 text-[11px] leading-4 text-muted-foreground">A buy lowers the virtual stake in the header. Closing a winner raises it. Closing a loser leaves it lower.</p></div>
      <Button className="h-11 w-full rounded-lg" disabled={Boolean(paperAction)} onClick={() => {
        setPaperAction('buy');
        setPaperNote('');
        setPaperReceipt(null);
        void fetch('/api/trading/paper-buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spend: 100 }) })
          .then(async response => {
            const body = await response.json() as { message?: string; error?: string; receipt?: PaperReceipt };
            if (!response.ok) throw new Error(body.error || 'The paper buy was not filled.');
            setPaperReceipt(body.receipt ?? null);
            await market.refreshStake();
            setPaperNote(body.receipt ? '' : (body.message || 'Paper buy filled.'));
            void queryClient.invalidateQueries();
          })
          .catch(reason => setPaperNote(reason instanceof Error ? reason.message : 'The paper buy was not filled.'))
          .finally(() => setPaperAction(''));
      }} data-testid="button-paper-buy-100">{paperAction === 'buy' ? 'Buying…' : 'Paper buy $100'}</Button>
      <Button variant="outline" className="h-11 w-full rounded-lg" disabled={Boolean(paperAction)} onClick={() => {
        setPaperAction('close');
        setPaperNote('');
        void fetch('/api/trading/paper-close', { method: 'POST' })
          .then(async response => {
            const body = await response.json() as { message?: string; error?: string };
            if (!response.ok) throw new Error(body.error || 'The paper position was not closed.');
            await market.refreshStake();
            setPaperReceipt(null);
            setPaperNote(body.message || 'Paper position closed.');
            void queryClient.invalidateQueries();
          })
          .catch(reason => setPaperNote(reason instanceof Error ? reason.message : 'The paper position was not closed.'))
          .finally(() => setPaperAction(''));
      }} data-testid="button-paper-close">{paperAction === 'close' ? 'Closing…' : 'Close paper position'}</Button>
      {paperReceipt && <div className="rounded-xl border border-border bg-muted/30 p-3" data-testid="paper-receipt">
        <p className="text-[11px] font-semibold text-muted-foreground">Paper receipt</p>
        <p className="mt-1 font-mono-data text-base font-semibold">{fmt(paperReceipt.quantity, 6)} {paperReceipt.base}</p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">Live price</span><span className="text-right font-mono-data">{fmt(paperReceipt.livePrice, 5)} {paperReceipt.quote}</span>
          <span className="text-muted-foreground">Fill</span><span className="text-right font-mono-data">{fmt(paperReceipt.fillPrice, 4)}</span>
          <span className="text-muted-foreground">Spent</span><span className="text-right font-mono-data">{fmt(paperReceipt.spent, 4)} {paperReceipt.quote}</span>
          <span className="text-muted-foreground">Fee</span><span className="text-right font-mono-data">{fmt(paperReceipt.fee, 4)}</span>
          <span className="text-muted-foreground">Slippage</span><span className="text-right font-mono-data">{fmt(paperReceipt.slippage, 4)}</span>
          <span className="text-muted-foreground">Virtual cost</span><span className="text-right font-mono-data">{fmt(paperReceipt.virtualCost, 4)}</span>
          <span className="text-muted-foreground">Cash left</span><span className="text-right font-mono-data">{fmt(paperReceipt.cashLeft, 2)} {paperReceipt.quote}</span>
        </div>
        <Link href="/xrp-wallet" className="mt-2 inline-block text-[11px] font-semibold text-primary">Real XRP is approved on the wallet page</Link>
      </div>}
      {paperNote && <p className="whitespace-pre-line text-[11px] leading-4 text-muted-foreground">{paperNote}</p>}
      {state !== 'halted' && <button type="button" className="w-full text-center text-[11px] font-semibold text-red-500" disabled={emergency.isPending} onClick={() => { if (window.confirm('Emergency stop paper trading? This halts all new orders.')) emergency.mutate(); }} data-testid="button-emergency-stop">{emergency.isPending ? 'Halting…' : 'Emergency stop'}</button>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {status.data?.message && <p className="text-[11px] leading-4 text-muted-foreground">{status.data.message}</p>}
    </div>
  </Panel>;
}

const strategyDefaults: StrategyInput = {
  name: 'EMA / RSI observation', symbol: 'XRP/USDT', interval: '1h', type: 'ema_crossover',
  params: { fastEma: 12, slowEma: 26, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9, bollingerPeriod: 20, bollingerStdDev: 2 },
  stopLossPct: 2.5, takeProfitPct: 4, trailingStopPct: null, maxPositionPct: 10, maxDailyLossPct: 3, maxTradesPerDay: 6, cooldownSeconds: 300, minConfidence: 0.6,
};
const strategyNumericFields: { key: keyof StrategyInput; label: string; suffix?: string; step: string; min: number; max: number; optional?: boolean }[] = [
  { key: 'stopLossPct', label: 'Stop loss', suffix: '%', step: '0.1', min: 0.1, max: 25 },
  { key: 'takeProfitPct', label: 'Take profit', suffix: '%', step: '0.1', min: 0.1, max: 100 },
  { key: 'trailingStopPct', label: 'Trailing stop', suffix: '%', step: '0.1', min: 0, max: 25, optional: true },
  { key: 'maxPositionPct', label: 'Position cap', suffix: '%', step: '0.1', min: 0.1, max: 100 },
  { key: 'maxDailyLossPct', label: 'Daily loss cap', suffix: '%', step: '0.1', min: 0.1, max: 100 },
  { key: 'maxTradesPerDay', label: 'Trades / day', step: '1', min: 1, max: 1000 },
  { key: 'cooldownSeconds', label: 'Cooldown', suffix: 'sec', step: '1', min: 0, max: 86400 },
  { key: 'minConfidence', label: 'Min confidence', step: '0.01', min: 0, max: 1 },
];
const signalModels: { value: StrategyInput['type']; label: string; detail: string }[] = [
  { value: 'ema_crossover', label: 'EMA crossover', detail: 'Fast average crosses the slow average' },
  { value: 'rsi_reversion', label: 'RSI reversion', detail: 'Buy oversold, sell overbought' },
  { value: 'macd', label: 'MACD', detail: 'Signal line crosses the MACD line' },
  { value: 'bollinger', label: 'Bollinger bands', detail: 'Price stretches outside the bands' },
  { value: 'combined', label: 'Combined', detail: 'Every indicator is evaluated together' },
];
const candleIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
const indicatorFields: { key: keyof StrategyInput['params']; label: string; min: number; max: number; step?: string }[] = [
  { key: 'fastEma', label: 'Fast EMA', min: 2, max: 200 },
  { key: 'slowEma', label: 'Slow EMA', min: 3, max: 500 },
  { key: 'rsiPeriod', label: 'RSI period', min: 2, max: 100 },
  { key: 'rsiOversold', label: 'RSI oversold', min: 1, max: 49 },
  { key: 'rsiOverbought', label: 'RSI overbought', min: 51, max: 99 },
  { key: 'macdFast', label: 'MACD fast', min: 2, max: 100 },
  { key: 'macdSlow', label: 'MACD slow', min: 3, max: 200 },
  { key: 'macdSignal', label: 'MACD signal', min: 2, max: 100 },
  { key: 'bollingerPeriod', label: 'Bollinger period', min: 5, max: 200 },
  { key: 'bollingerStdDev', label: 'Bollinger deviation', min: 0.1, max: 5, step: '.1' },
];
function indicatorWarning(form: StrategyInput): string | null {
  if (form.params.fastEma >= form.params.slowEma) return 'Fast EMA must be shorter than slow EMA.';
  if (form.params.rsiOversold >= form.params.rsiOverbought) return 'RSI oversold must stay below RSI overbought.';
  if (form.params.macdFast >= form.params.macdSlow) return 'MACD fast must be shorter than MACD slow.';
  return null;
}
function visibleIndicators(type: StrategyInput['type']) {
  return indicatorFields.filter(item => {
    if (type === 'combined') return true;
    if (type === 'ema_crossover') return item.key === 'fastEma' || item.key === 'slowEma';
    if (type === 'rsi_reversion') return item.key.startsWith('rsi');
    if (type === 'macd') return item.key.startsWith('macd');
    return item.key.startsWith('bollinger');
  });
}
function StrategyDialog({ strategy, onClose }: { strategy?: Strategy; onClose: () => void }) {
  const queryClient = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateStrategy({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const update = useUpdateStrategy({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const [form, setForm] = useState<StrategyInput>(() => strategy ? {
    name: strategy.name, symbol: strategy.symbol, interval: strategy.interval, type: strategy.type,
    params: strategy.params, stopLossPct: strategy.stopLossPct, takeProfitPct: strategy.takeProfitPct,
    trailingStopPct: strategy.trailingStopPct, maxPositionPct: strategy.maxPositionPct,
    maxDailyLossPct: strategy.maxDailyLossPct, maxTradesPerDay: strategy.maxTradesPerDay,
    cooldownSeconds: strategy.cooldownSeconds, minConfidence: strategy.minConfidence,
  } : strategyDefaults);
  const busy = create.isPending || update.isPending;
  const warning = indicatorWarning(form);
  const symbols = Array.from(new Set([form.symbol, ...DESK_PAIRS]));
  const inputClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary';
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  function field<K extends keyof StrategyInput>(key: K, value: StrategyInput[K]) { setForm(v => ({ ...v, [key]: value })); }
  function paramField<K extends keyof StrategyInput['params']>(key: K, value: StrategyInput['params'][K]) {
    setForm(v => ({ ...v, params: { ...v.params, [key]: value } }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (warning) return;
    if (strategy) update.mutate({ id: strategy.id, data: form }, { onSuccess: onClose });
    else create.mutate({ data: form }, { onSuccess: onClose });
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation" onMouseDown={onClose}>
      <form onSubmit={submit} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="strategy-dialog-title" className="flex max-h-[92dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-xl sm:rounded-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="eyebrow">{strategy ? 'Configuration' : 'New configuration'}</p>
            <h2 id="strategy-dialog-title" className="mt-1 text-lg font-semibold">{strategy ? 'Edit strategy' : 'Create strategy'}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Paper orders only. The engine uses this symbol, interval, and the limits below.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close form" className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2"><span className="eyebrow">Strategy name</span><input ref={nameRef} required maxLength={80} value={form.name} onChange={e => field('name', e.target.value)} className={inputClass} data-testid="input-strategy-name" /></label>
            <div className="space-y-1.5">
              <span className="eyebrow">Symbol</span>
              <div className="flex flex-wrap gap-1.5" data-testid="input-strategy-symbol">{symbols.map(pair => <button key={pair} type="button" onClick={() => field('symbol', pair)} className={cx('rounded-md border px-2.5 py-1.5 font-mono-data text-xs font-semibold', form.symbol === pair ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground')}>{pair}</button>)}</div>
            </div>
            <div className="space-y-1.5">
              <span className="eyebrow">Interval</span>
              <div className="flex flex-wrap gap-1.5" data-testid="select-strategy-interval">{candleIntervals.map(item => <button key={item} type="button" onClick={() => field('interval', item)} className={cx('rounded-md border px-2.5 py-1.5 font-mono-data text-xs font-semibold', form.interval === item ? 'border-primary bg-primary text-white' : 'border-border bg-background text-muted-foreground hover:text-foreground')}>{item}</button>)}</div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <span className="eyebrow">Signal model</span>
              <div className="grid gap-2 sm:grid-cols-2" data-testid="select-strategy-type">{signalModels.map(model => <button key={model.value} type="button" onClick={() => field('type', model.value)} className={cx('rounded-lg border px-3 py-2.5 text-left', form.type === model.value ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-muted')}><span className="block text-sm font-semibold">{model.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{model.detail}</span></button>)}</div>
            </div>
            <div className="eyebrow sm:col-span-2">Indicator parameters</div>
            {visibleIndicators(form.type).map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><input type="number" required min={item.min} max={item.max} step={item.step ?? 1} value={form.params[item.key]} onChange={e => paramField(item.key, Number(e.target.value))} className={cx(inputClass, 'font-mono-data')} data-testid={`input-indicator-${item.key}`} /></label>)}
            {warning && <p className="text-xs text-destructive sm:col-span-2">{warning}</p>}
            <div className="eyebrow sm:col-span-2">Risk controls</div>
            {strategyNumericFields.map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><div className="relative"><input type="number" required={!item.optional} min={item.min} max={item.max} step={item.step} placeholder={item.optional ? 'Off' : undefined} value={form[item.key] == null ? '' : String(form[item.key])} onChange={e => field(item.key, (e.target.value === '' && item.optional ? null : Number(e.target.value)) as never)} className={cx(inputClass, 'font-mono-data', item.suffix && 'pr-12')} data-testid={`input-${String(item.key)}`} />{item.suffix && <span className="pointer-events-none absolute right-3 top-3 text-[10px] text-muted-foreground">{item.suffix}</span>}</div></label>)}
            <p className="text-[11px] leading-5 text-muted-foreground sm:col-span-2">Stop loss is capped at 25%. Min confidence is a fraction from 0 to 1. Other indicator settings stay saved when you switch models.</p>
            {(create.error || update.error) && <p className="text-xs text-destructive sm:col-span-2">{readableError(create.error || update.error) ?? 'Could not save this strategy. Check field limits and retry.'}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4">
          <p className="hidden text-[11px] text-muted-foreground sm:block">{form.symbol} · {form.interval}</p>
          <div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || Boolean(warning)} data-testid="button-save-strategy">{busy ? 'Saving…' : strategy ? 'Save changes' : 'Create strategy'}</Button></div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
function StrategiesPage() {
  const queryClient = useQueryClient();
  const query = useGetStrategies();
  const update = useUpdateStrategy({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const [dialog, setDialog] = useState<Strategy | null | false>(false);
  const items = query.data ?? [];
  return <div>
    <PageHeading title="Strategies" detail="Build bounded paper strategies and keep every configuration legible." action={<Button onClick={() => setDialog(null)} data-testid="button-create-strategy"><Plus size={15} />New strategy</Button>} />
    {query.isError && !query.data ? <QueryState error retry={() => query.refetch()}>{null}</QueryState> : query.isLoading ? <LoadingPanel rows={5} /> : !items.length ? <Panel className="px-6 py-12 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent text-primary"><Crosshair size={18} /></span><h2 className="mt-4 text-sm font-semibold">Start with a testable idea</h2><p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Create a strategy configuration with clear entry signals and defined downside limits.</p><Button className="mt-4" onClick={() => setDialog(null)}><Plus size={14} />Create a strategy</Button></Panel> : <div className="grid gap-4 xl:grid-cols-2">{items.map((s, i) => <StrategyCard key={s.id} strategy={s} index={i} pending={update.isPending} onEdit={() => setDialog(s)} onToggle={() => update.mutate({ id: s.id, data: { active: !s.active } })} />)}</div>}
    {update.isSuccess && <p className="mt-3 text-xs font-medium text-primary" role="status">Strategy configuration updated.</p>}
    {update.isError && <p className="mt-3 text-xs text-destructive">{readableError(update.error) ?? 'Could not update the strategy. Try again.'}</p>}
    {dialog !== false && <StrategyDialog strategy={dialog || undefined} onClose={() => setDialog(false)} />}
  </div>;
}
function StrategyCard({ strategy: s, index, pending, onEdit, onToggle }: { strategy: Strategy; index: number; pending: boolean; onEdit: () => void; onToggle: () => void }) {
  return <Panel className="overflow-hidden" data-testid={`card-strategy-${s.id}`}><div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-primary"><span className="font-mono-data text-xs">0{index + 1}</span></span><div><h2 className="text-sm font-semibold">{s.name}</h2><p className="mt-1 font-mono-data text-[10px] text-muted-foreground">{s.symbol} · {s.interval} · {s.type.replaceAll('_', ' ')}</p></div></div><StatusPill tone={s.active ? 'good' : 'neutral'}>{s.active ? 'Active' : 'Paused'}</StatusPill></div>
    <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">{[['Stop loss', `${fmt(s.stopLossPct)}%`], ['Take profit', `${fmt(s.takeProfitPct)}%`], ['Max position', `${fmt(s.maxPositionPct)}%`], ['Daily loss cap', `${fmt(s.maxDailyLossPct)}%`]].map(([label, value]) => <div key={label} className="px-4 py-3"><p className="eyebrow">{label}</p><p className="mt-1.5 font-mono-data text-sm">{value}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-4 py-3"><div className="flex gap-4 text-[10px] text-muted-foreground"><span><b className="font-mono-data text-foreground">{s.maxTradesPerDay}</b> trades/day</span><span><b className="font-mono-data text-foreground">{fmt(s.minConfidence * 100, 0)}%</b> confidence floor</span><span><b className="font-mono-data text-foreground">{s.cooldownSeconds}s</b> cooldown</span></div><div className="flex gap-2"><Button variant="outline" className="min-h-8 px-2.5 text-[11px]" onClick={onEdit} data-testid={`button-edit-strategy-${s.id}`}><SlidersHorizontal size={13} />Edit</Button><Button variant={s.active ? 'ghost' : 'solid'} className="min-h-8 px-2.5 text-[11px]" disabled={pending} onClick={onToggle} data-testid={`button-toggle-strategy-${s.id}`}>{s.active ? 'Pause' : 'Activate'}</Button></div></div>
  </Panel>;
}

function BacktestsPage() {
  const queryClient = useQueryClient();
  const market = useDeskMarket();
  const strategies = useGetStrategies();
  const backtests = useGetBacktests();
  const stakeRef = useRef(market.virtualXrp);
  const run = useRunBacktest({ mutation: { onSuccess: result => {
    queryClient.setQueryData(getGetBacktestQueryKey(result.id), result);
    void queryClient.invalidateQueries({ queryKey: getGetBacktestsQueryKey() });
    const ending = stakeRef.current * (1 + result.totalReturnPct / 100);
    market.setVirtualXrp(ending);
  } } });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<BacktestInput>({ strategyId: '', symbol: 'XRP/USDT', interval: '1h', days: 90, initialCapital: 200, feeBps: 10, slippageBps: 5 });
  const [ranStake, setRanStake] = useState(200);
  const selectedQuery = useGetBacktest(selectedId, { query: { enabled: Boolean(selectedId), queryKey: getGetBacktestQueryKey(selectedId) } });
  const result = (run.data ?? selectedQuery.data) as Backtest | undefined;
  const [recentClick, setRecentClick] = useState(false);
  useEffect(() => {
    if (!form.strategyId && strategies.data?.[0]) setForm(v => ({ ...v, strategyId: strategies.data?.[0].id ?? '' }));
  }, [form.strategyId, strategies.data]);
  function submit(e: FormEvent) {
    e.preventDefault();
    setRecentClick(false);
    const stake = market.virtualXrp;
    stakeRef.current = stake;
    setRanStake(stake);
    const data = { ...form, initialCapital: stake, startingXrp: stake };
    run.mutate({ data: data as BacktestInput });
  }
  return <div>
    <PageHeading title="Backtests" detail="A virtual test starts with the XRP amount in the header. That stake is valued at the first candle, then fee and slippage are applied on each fill." />
    <div className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]">
      <Panel className="h-fit overflow-hidden"><PanelHeader title="Test parameters" detail="Every run uses real historical market data." />
        <form className="space-y-4 p-4" onSubmit={submit}>
          <label className="block space-y-1.5"><span className="eyebrow">Strategy</span><select required value={form.strategyId} onChange={e => setForm(v => ({ ...v, strategyId: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-backtest-strategy"><option value="">Choose strategy</option>{strategies.data?.map(s => <option key={s.id} value={s.id}>{s.name} · {s.symbol}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5"><span className="eyebrow">Symbol</span><input value={form.symbol} onChange={e => setForm(v => ({ ...v, symbol: e.target.value.toUpperCase() }))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid="input-backtest-symbol" /></label><label className="space-y-1.5"><span className="eyebrow">Candle interval</span><select value={form.interval} onChange={e => setForm(v => ({ ...v, interval: e.target.value as BacktestInput['interval'] }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-backtest-interval">{['1m', '5m', '15m', '1h', '4h', '1d'].map(v => <option key={v}>{v}</option>)}</select></label></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5"><span className="eyebrow">Starting XRP</span><input type="number" required min={1} max={1000000} step={1} value={market.virtualXrp} onChange={e => market.setVirtualXrp(Number(e.target.value))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid="input-backtest-starting-xrp" /></label>
            {[{ key: 'days', label: 'Historical days', min: 1, max: 365, step: 1 }, { key: 'feeBps', label: 'Fee (bps)', min: 0, max: 100, step: 1 }, { key: 'slippageBps', label: 'Slippage (bps)', min: 0, max: 100, step: 1 }].map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><input type="number" required min={item.min} max={item.max} step={item.step} value={form[item.key as keyof BacktestInput]} onChange={e => setForm(v => ({ ...v, [item.key]: Number(e.target.value) }))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid={`input-backtest-${item.key}`} /></label>)}
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">The header shows this stake. When the run finishes, a loss replaces it with less XRP and a win replaces it with more. The next test starts from that new amount.</p>
          <Button type="submit" className="w-full" disabled={run.isPending || !form.strategyId} data-testid="button-run-backtest"><BarChart3 size={14} />{run.isPending ? 'Evaluating history…' : 'Run backtest'}</Button>
          {run.isError && <p className="text-xs text-destructive">{readableError(run.error) ?? 'Backtest could not run. Confirm the symbol, interval and selected strategy.'}</p>}
          {run.isSuccess && <p className="text-xs font-medium text-primary" role="status">Run complete. Metrics below reflect the returned result.</p>}
        </form>
      </Panel>
      <div className="space-y-4">
        {result ? <BacktestResult result={result} startingXrp={run.data && result.id === run.data.id ? ranStake : null} /> : <Panel className="flex min-h-[290px] flex-col items-center justify-center px-6 py-12 text-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-primary"><FileChartColumn size={18} /></span><h2 className="mt-4 text-sm font-semibold">A virtual result</h2><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Start with {fmt(market.virtualXrp, 0)} XRP. The test spends that stake on historical candles and keeps the fee visible.</p></Panel>}
        <Panel><PanelHeader title="Recent runs" detail="Select a completed backtest to inspect its metrics." aside={<Button variant="ghost" className="min-h-7 px-2 text-[10px]" onClick={() => void backtests.refetch()}><RefreshCw size={12} />Refresh</Button>} />
          {backtests.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" /></div> : backtests.isError && !backtests.data ? <div className="p-4 text-xs text-destructive">Backtest history unavailable. <button className="underline" onClick={() => void backtests.refetch()}>Retry</button></div> : backtests.data?.length ? <div className="divide-y divide-border">{backtests.data.slice(0, 6).map(b => <button key={b.id} onClick={() => { setSelectedId(b.id); setRecentClick(true); }} className={cx('flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40', selectedId === b.id && recentClick && 'bg-accent/50')} data-testid={`button-backtest-${b.id}`}><div><p className="text-xs font-semibold">{b.strategyName}</p><p className="mt-1 font-mono-data text-[9px] text-muted-foreground">{b.symbol} · {b.interval} · {dateTime(b.createdAt)}</p></div><div className="text-right"><p className={cx('font-mono-data text-xs', b.totalReturnPct >= 0 ? 'text-primary' : 'text-destructive')}>{percent(b.totalReturnPct)}</p><p className="mt-1 text-[9px] text-muted-foreground">{b.tradeCount} trades</p></div></button>)}</div> : <div className="px-4 py-8 text-center text-xs text-muted-foreground">No previous runs.</div>}
        </Panel>
      </div>
    </div>
  </div>;
}
function BacktestResult({ result: b, startingXrp }: { result: Backtest; startingXrp: number | null }) {
  const endingXrp = startingXrp == null ? null : startingXrp * (1 + b.totalReturnPct / 100);
  return <Panel className="overflow-hidden"><PanelHeader title="Evaluation result" detail={`${b.strategyName} · ${b.symbol} · ${b.interval}${startingXrp == null ? '' : ' · virtual'}`} aside={<StatusPill tone="good">Completed</StatusPill>} />
    {startingXrp != null && endingXrp != null && <div className="grid border-b border-white/10 bg-[#0B1220] text-white sm:grid-cols-2"><div className="px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-emerald-200">Started</p><p className="mt-1 font-mono-data text-2xl font-semibold">{fmt(startingXrp, 2)} XRP</p></div><div className="border-t border-white/10 px-4 py-4 sm:border-l sm:border-t-0"><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-white/50">Ended</p><p className={cx('mt-1 font-mono-data text-2xl font-semibold', endingXrp >= startingXrp ? 'text-emerald-300' : 'text-red-300')}>{fmt(endingXrp, 2)} XRP</p></div></div>}
    <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">{[['Net return', percent(b.totalReturnPct)], ['Net profit', money(b.netProfit)], ['Win rate', `${fmt(b.winRate)}%`], ['Max drawdown', `${fmt(b.maxDrawdownPct)}%`]].map(([l, v], i) => <div key={l} className={cx('border-r border-border px-4 py-3 last:border-r-0', i > 1 && 'border-t sm:border-t-0')}><p className="eyebrow">{l}</p><p className={cx('mt-1.5 font-mono-data text-base', i === 0 && b.totalReturnPct >= 0 ? 'text-primary' : i === 0 && b.totalReturnPct < 0 ? 'text-destructive' : '')}>{v}</p></div>)}</div>
    <div className="grid grid-cols-2 gap-y-3 px-4 py-3 sm:grid-cols-4">{[['Trades', b.tradeCount], ['Profit factor', b.profitFactor == null ? '—' : fmt(b.profitFactor)], ['Sharpe ratio', fmt(b.sharpeRatio)], ['Avg. trade', money(b.averageTrade)]].map(([l, v]) => <div key={String(l)}><p className="eyebrow">{l}</p><p className="mt-1 font-mono-data text-xs">{v}</p></div>)}</div>
    <div className="border-t border-border px-4 py-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">Equity curve</p><p className="eyebrow">Beginning to end</p></div><div className="h-[120px]">{b.equityCurve?.length ? <EquityChart data={b.equityCurve} /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No equity curve returned.</div>}</div></div>
  </Panel>;
}
function EquityChart({ data }: { data: Backtest['equityCurve'] }) {
  const values = data.map(p => p.equity); const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const points = values.map((v, i) => `${i / Math.max(1, values.length - 1) * 100},${100 - (v - min) / range * 85}`).join(' ');
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><line x1="0" x2="100" y1="99" y2="99" stroke="hsl(var(--border))" vectorEffect="non-scaling-stroke" /><polyline points={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.7" vectorEffect="non-scaling-stroke" /></svg>;
}

function ActivityPage({ initialTab = 'Trades', title = 'Trade History', detail = 'Trade, order, position and signal records from paper execution.' }: { initialTab?: string; title?: string; detail?: string }) {
  const [tab, setTab] = useState(initialTab);
  const trades = useGetTrades({ limit: 100 });
  const orders = useGetOrders({ limit: 100 });
  const positions = useGetPositions();
  const signals = useGetSignals({ limit: 100 });
  const [filter, setFilter] = useState('');
  const tabs = ['Trades', 'Orders', 'Positions', 'Signals'];
  return <div>
    <PageHeading title={title} detail={detail} action={<label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter symbol…" className="h-9 w-[190px] rounded-md border border-input bg-white pl-9 pr-3 text-xs" data-testid="input-activity-filter" /></label>} />
    <Panel className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 pt-3"><div className="flex gap-1">{tabs.map(item => <button key={item} onClick={() => setTab(item)} className={cx('relative px-3 py-2.5 text-xs font-semibold', tab === item ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} data-testid={`tab-${item.toLowerCase()}`}>{item}{tab === item && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />}</button>)}</div><Button variant="ghost" className="min-h-7 text-[10px]" onClick={() => { void trades.refetch(); void orders.refetch(); void positions.refetch(); void signals.refetch(); }}><RefreshCw size={12} />Refresh</Button></div>
      {tab === 'Trades' && <ActivityQuery query={trades} retry={() => void trades.refetch()} empty={!trades.data?.some(v => v.symbol.toLowerCase().includes(filter.toLowerCase()))} note={filter ? `No rows match “${filter}”.` : undefined}><TableWrap><TableHead><tr>{['Symbol', 'Strategy', 'Entry → exit', 'Net P&L', 'Exit reason', 'Closed'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{trades.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(t => <tr key={t.id} data-testid={`row-trade-${t.id}`}><td className="px-4 py-3 font-semibold">{t.symbol}</td><td className="px-4 py-3 text-muted-foreground">{t.strategyName}</td><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px]">{fmt(t.entryPrice, 4)} <ArrowRight size={11} className="mx-1 inline text-muted-foreground" />{fmt(t.exitPrice, 4)}</td><td className="px-4 py-3"><MoneyValue value={t.netPnl} /></td><td className="px-4 py-3 text-muted-foreground">{t.exitReason}</td><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(t.closedAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Orders' && <ActivityQuery query={orders} retry={() => void orders.refetch()} empty={!orders.data?.some(v => v.symbol.toLowerCase().includes(filter.toLowerCase()))} note={filter ? `No rows match “${filter}”.` : undefined}><TableWrap><TableHead><tr>{['Symbol', 'Side', 'Quantity', 'Fill price', 'Fee', 'Status', 'Created'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{orders.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(o => <tr key={o.id} data-testid={`row-order-${o.id}`}><td className="px-4 py-3 font-semibold">{o.symbol}</td><td className="px-4 py-3"><StatusPill tone={o.side === 'buy' ? 'good' : 'bad'}>{o.side}</StatusPill></td><td className="px-4 py-3 font-mono-data">{fmt(o.quantity, 4)}</td><td className="px-4 py-3 font-mono-data">{money(o.price)}</td><td className="px-4 py-3 font-mono-data">{money(o.fee)}</td><td className="px-4 py-3 text-muted-foreground">{o.status}</td><td className="px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(o.createdAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Positions' && <ActivityQuery query={positions} retry={() => void positions.refetch()} empty={!positions.data?.some(v => v.symbol.toLowerCase().includes(filter.toLowerCase()))} note={filter ? `No rows match “${filter}”.` : undefined}><TableWrap><TableHead><tr>{['Symbol', 'Strategy', 'Quantity', 'Entry', 'Mark', 'Unrealized P&L', 'Opened'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{positions.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(p => <tr key={p.id} data-testid={`row-position-${p.id}`}><td className="px-4 py-3 font-semibold">{p.symbol}</td><td className="px-4 py-3 text-muted-foreground">{p.strategyName}</td><td className="px-4 py-3 font-mono-data">{fmt(p.quantity, 4)}</td><td className="px-4 py-3 font-mono-data">{money(p.entryPrice)}</td><td className="px-4 py-3 font-mono-data">{money(p.markPrice)}</td><td className="px-4 py-3"><MoneyValue value={p.unrealizedPnl} /></td><td className="px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(p.openedAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Signals' && <ActivityQuery query={signals} retry={() => void signals.refetch()} empty={!signals.data?.some(v => v.symbol.toLowerCase().includes(filter.toLowerCase()))} note={filter ? `No rows match “${filter}”.` : undefined}><TableWrap><TableHead><tr>{['Time', 'Instrument', 'Strategy', 'Side', 'Confidence', 'Risk outcome', 'Decision'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{signals.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(s => <tr key={s.id} data-testid={`row-signal-${s.id}`}><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(s.createdAt)}</td><td className="px-4 py-3 font-semibold">{s.symbol}</td><td className="px-4 py-3 text-muted-foreground">{s.strategyName}</td><td className="px-4 py-3"><StatusPill tone={s.side === 'buy' ? 'good' : s.side === 'sell' ? 'bad' : 'neutral'}>{s.side}</StatusPill></td><td className="px-4 py-3 font-mono-data">{fmt(s.confidence * 100, 0)}%</td><td className="px-4 py-3"><StatusPill tone={s.riskApproved ? 'good' : 'bad'}>{s.riskApproved ? 'Approved' : 'Blocked'}</StatusPill></td><td className="max-w-[280px] px-4 py-3 text-muted-foreground">{s.rejectionReason ?? s.message}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
    </Panel>
  </div>;
}
function ActivityQuery({ query, retry, empty, note, children }: { query: { isLoading: boolean; isError: boolean; data?: unknown }; retry: () => void; empty: boolean; note?: string; children: ReactNode }) {
  return <QueryState loading={query.isLoading} error={query.isError && !query.data} empty={empty} note={note} retry={retry}>{children}</QueryState>;
}

const riskFields: { key: keyof RiskSettingsInput; label: string; detail: string; step: number; suffix?: string }[] = [
  { key: 'riskPerTradePct', label: 'Risk per trade', detail: 'Maximum account equity at risk on an individual trade.', step: .1, suffix: '%' },
  { key: 'maxDailyLossPct', label: 'Max daily loss', detail: 'Stop new entries after this daily loss threshold.', step: .1, suffix: '%' },
  { key: 'maxPositionPct', label: 'Max position size', detail: 'Cap on one position relative to paper equity.', step: .5, suffix: '%' },
  { key: 'maxExposurePct', label: 'Max total exposure', detail: 'Aggregate open exposure limit.', step: 1, suffix: '%' },
  { key: 'maxDrawdownPct', label: 'Max drawdown', detail: 'Drawdown threshold to halt strategy activity.', step: .5, suffix: '%' },
  { key: 'maxOpenPositions', label: 'Open positions', detail: 'Maximum simultaneous positions in the account.', step: 1 },
  { key: 'maxTradesPerDay', label: 'Trades per day', detail: 'Daily order-count ceiling.', step: 1 },
  { key: 'feeBps', label: 'Simulated fees', detail: 'Fee assumption for paper fills.', step: 1, suffix: 'bps' },
  { key: 'slippageBps', label: 'Simulated slippage', detail: 'Slippage assumption for paper fills.', step: 1, suffix: 'bps' },
];
function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useGetRiskSettings();
  const validation = useGetPaperValidation();
  const status = useGetTradingStatus();
  const save = useUpdateRiskSettings({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetRiskSettingsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetPaperValidationQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
  } } });
  const [form, setForm] = useState<RiskSettingsInput | null>(null);
  const initialRef = useRef<RiskSettings | undefined>(undefined);
  useEffect(() => {
    if (query.data && initialRef.current !== query.data) {
      initialRef.current = query.data;
      setForm({ riskPerTradePct: query.data.riskPerTradePct, maxDailyLossPct: query.data.maxDailyLossPct, maxPositionPct: query.data.maxPositionPct, maxExposurePct: query.data.maxExposurePct, maxDrawdownPct: query.data.maxDrawdownPct, maxOpenPositions: query.data.maxOpenPositions, maxTradesPerDay: query.data.maxTradesPerDay, feeBps: query.data.feeBps, slippageBps: query.data.slippageBps });
    }
  }, [query.data]);
  function submit(e: FormEvent) { e.preventDefault(); if (form) save.mutate({ data: form }); }
  return <div>
    <PageHeading title="Risk settings" detail="Risk limits are guardrails, not a promise of performance." />
    <div className="mb-4 grid gap-3 sm:grid-cols-3">{query.data ? <><Metric label="Paper capital" value={money(query.data.initialPaperBalance)} note="Starting account balance" icon={Gauge} /><Metric label="Available balance" value={money(query.data.availableBalance)} note="Current free paper balance" icon={BarChart3} /><Metric label="Trading mode" value="PAPER" note={`Engine ${status.data?.state ?? 'unknown'}`} icon={ShieldCheck} /></> : <><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></>}</div>
    <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Panel className="overflow-hidden"><PanelHeader title="Account risk envelope" detail="Changes apply to paper execution and validation." />
        {query.isLoading && !form ? <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div> : query.isError && !form ? <div className="p-4"><QueryState error retry={() => void query.refetch()}>{null}</QueryState></div> : form && <form onSubmit={submit}><div className="divide-y divide-border">{riskFields.map(item => <label key={item.key} className="flex items-center justify-between gap-4 px-4 py-3.5"><div><span className="text-xs font-semibold">{item.label}</span><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{item.detail}</p></div><div className="relative w-[110px] shrink-0"><input type="number" required min={0} step={item.step} value={form[item.key]} onChange={e => setForm(v => v ? ({ ...v, [item.key]: Number(e.target.value) }) : v)} className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-right font-mono-data text-xs" data-testid={`input-risk-${item.key}`} />{item.suffix && <span className="absolute right-3 top-2.5 text-[9px] text-muted-foreground">{item.suffix}</span>}</div></label>)}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-4 py-3"><p className="max-w-xs text-[10px] text-muted-foreground">Balance is read-only here; only server-supported risk settings can be changed.</p><Button type="submit" disabled={save.isPending || !form} data-testid="button-save-risk-settings">{save.isPending ? 'Saving…' : 'Save risk settings'}</Button></div>{save.isSuccess && <p className="px-4 py-3 text-xs font-medium text-primary" role="status">Risk settings saved successfully.</p>}{save.isError && <p className="px-4 py-3 text-xs text-destructive">{readableError(save.error) ?? 'Could not save risk settings. Verify each value is within API limits.'}</p>}</form>}
      </Panel>
      <Panel className="overflow-hidden"><PanelHeader title="Paper validation" detail="Readiness checks returned by the API" aside={validation.data && <StatusPill tone={validation.data.checks.some(c => c.status === 'blocked') ? 'bad' : validation.data.checks.every(c => c.status === 'passed') ? 'good' : 'warn'}>{validation.data.checks.some(c => c.status === 'blocked') ? 'Blocked' : validation.data.checks.every(c => c.status === 'passed') ? 'Ready' : 'Review'}</StatusPill>} />
        {validation.isLoading
          ? <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : validation.isError && !validation.data
            ? <div className="p-4"><QueryState error retry={() => void validation.refetch()}>{null}</QueryState></div>
            : validation.data?.checks.length
              ? <div className="divide-y divide-border">{validation.data.checks.map(check => <div key={check.id} className="flex gap-3 px-4 py-3.5" data-testid={`validation-${check.id}`}>
                  <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full', check.status === 'passed' ? 'bg-primary/15 text-primary' : check.status === 'blocked' ? 'bg-destructive/15 text-destructive' : 'bg-amber-100 text-amber-700')}>{check.status === 'passed' ? <Check size={13} /> : check.status === 'blocked' ? <X size={13} /> : <Clock3 size={13} />}</span>
                  <div className="flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{check.label}</p><StatusPill tone={check.status === 'passed' ? 'good' : check.status === 'blocked' ? 'bad' : 'warn'}>{check.status}</StatusPill></div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{check.detail}</p></div>
                </div>)}</div>
              : <div className="p-5 text-center text-xs text-muted-foreground">No validation checks returned.</div>}
        <div className="border-t border-border bg-muted/25 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] font-medium">Live trading status</span><span className="font-mono-data text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground">{validation.data?.liveTradingEnabled === false ? 'Disabled' : 'Not enabled'}</span></div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">Paper bot orders stay simulated. Real XRP moves only from the XRP wallet page, signed in your browser wallet.</p></div>
      </Panel>
    </div>
  </div>;
}

function StampRoute() {
  const market = useDeskMarket();
  return <StampChasePage stake={market.virtualXrp} onStake={() => void market.refreshStake()} />;
}
function CoinRoute() {
  const market = useDeskMarket();
  return <CoinRunPage stake={market.virtualXrp} onStake={() => void market.refreshStake()} />;
}
function TankRoute() {
  const market = useDeskMarket();
  return <TankRoomPage stake={market.virtualXrp} onStake={() => void market.refreshStake()} />;
}
function AnalysisRoute() {
  const market = useDeskMarket();
  return <AnalysisPage symbol={market.symbol} ticker={market.ticker} />;
}
function DemoRoute() {
  const market = useDeskMarket();
  const client = useQueryClient();
  return <DemoPage onSymbol={market.setSymbol} onChange={() => { void client.invalidateQueries(); }} />;
}
function AppRoutes() {
  return <Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/user-portal"><Guard><PortalShell><Overview /></PortalShell></Guard></Route>
    <Route path="/analysis"><Guard><PortalShell><AnalysisRoute /></PortalShell></Guard></Route>
    <Route path="/telegram"><Guard><PortalShell><TelegramPage /></PortalShell></Guard></Route>
    <Route path="/demo"><Guard><PortalShell><DemoRoute /></PortalShell></Guard></Route>
    <Route path="/stamp-chase"><Guard><PortalShell><StampRoute /></PortalShell></Guard></Route>
    <Route path="/coin-run"><Guard><PortalShell><CoinRoute /></PortalShell></Guard></Route>
    <Route path="/game-room"><Guard><PortalShell><TankRoute /></PortalShell></Guard></Route>
    <Route path="/strategies"><Guard><PortalShell><StrategiesPage /></PortalShell></Guard></Route>
    <Route path="/backtests"><Guard><PortalShell><BacktestsPage /></PortalShell></Guard></Route>
    <Route path="/activity"><Guard><PortalShell><ActivityPage /></PortalShell></Guard></Route>
    <Route path="/portfolio"><Redirect to="/user-portal" /></Route>
    <Route path="/xrp-wallet"><Guard><PortalShell><XrpWalletPage /></PortalShell></Guard></Route>
    <Route path="/notifications"><Guard><PortalShell><ActivityPage initialTab="Signals" title="Notifications" detail="Signal decisions and risk outcomes from the paper engine." /></PortalShell></Guard></Route>
    <Route path="/settings"><Guard><PortalShell><SettingsPage /></PortalShell></Guard></Route>
    <Route><NotFound /></Route>
  </Switch>;
}
function sessionUserFor(profile: DemoProfile): SessionUser {
  const slug = profile.id === DEFAULT_PROFILE.id ? 'local' : profile.id.replace(/^local-/, '');
  return { firstName: profile.name, email: `${slug}@xrp.quant`, initial: (profile.name[0] ?? 'T').toUpperCase() };
}
function DemoSession({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const [profiles, setProfiles] = useState(listProfiles);
  const [signedIn, setSignedIn] = useState(() => window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1');
  const [current, setCurrent] = useState<DemoProfile | null>(() => {
    const id = currentProfileId();
    if (id) return profileFromId(id);
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1' ? DEFAULT_PROFILE : null;
  });
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === 'xrpq-demo-profiles') setProfiles(listProfiles()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const leave = () => {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
    window.sessionStorage.removeItem('xrpq-virtual-xrp');
    setCurrentProfile(null);
    setCurrent(null);
    setSignedIn(false);
    client.clear();
  };
  const enterAs = (profile: DemoProfile) => {
    if (current?.id !== profile.id) {
      window.sessionStorage.removeItem('xrpq-virtual-xrp');
      client.clear();
    }
    setCurrentProfile(profile.id);
    window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
    setCurrent(profile);
    setSignedIn(true);
    setLocation('/user-portal');
  };
  const value: SessionValue = {
    signedIn: signedIn && current != null,
    user: sessionUserFor(current ?? DEFAULT_PROFILE),
    signIn: () => {
      if (current) enterAs(current);
      else setLocation('/sign-in');
    },
    signOut: () => {
      leave();
      setLocation('/');
    },
    switchUser: () => {
      leave();
      setLocation('/sign-in');
    },
  };
  const profilesValue: DemoProfilesValue = {
    profiles,
    current,
    enterAs,
    login: raw => {
      const profile = loginWithId(raw);
      if (!profile) return false;
      setProfiles(listProfiles());
      enterAs(profile);
      return true;
    },
    remove: id => {
      removeProfile(id);
      setProfiles(listProfiles());
    },
  };
  return <DemoProfilesContext.Provider value={profilesValue}><SessionContext.Provider value={value}>{children}</SessionContext.Provider></DemoProfilesContext.Provider>;
}
function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) client.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}
function ClerkSession({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const value: SessionValue = {
    signedIn: Boolean(user),
    user: {
      firstName: user?.firstName ?? 'Researcher',
      email: user?.primaryEmailAddress?.emailAddress ?? '',
      initial: (user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? 'Q').toUpperCase(),
    },
    signIn: () => setLocation('/sign-in'),
    signOut: () => { void signOut({ redirectUrl: basePath || '/' }); },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
function Routed() {
  const [, setLocation] = useLocation();
  if (demoMode) return <DemoSession><AppRoutes /></DemoSession>;
  return <ClerkProvider publishableKey={clerkPubKey!} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to review your XRP paper workspace.' } }, signUp: { start: { title: 'Create your account', subtitle: 'Build a more disciplined XRP testing process.' } } }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <ClerkCacheInvalidator />
    <ClerkSession><AppRoutes /></ClerkSession>
  </ClerkProvider>;
}
function NotFound() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5 text-center"><div><p className="eyebrow">404 · NOT IN THIS LEDGER</p><h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">That route isn’t available.</h1><Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">Back to XRP TradeBot <ArrowRight size={14} /></Link></div></div>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><Routed /></WouterRouter></QueryClientProvider>;
}

export default App;