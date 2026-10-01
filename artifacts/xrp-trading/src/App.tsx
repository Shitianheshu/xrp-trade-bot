import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, BookOpen,
  Check, ChevronDown, Clock3, Crosshair, FileChartColumn,
  Gauge, LayoutDashboard, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Search,
  Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal,
  TrendingUp, X, Zap,
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
  useGetSignals,
  useGetStrategies,
  useGetTradingDashboard,
  useGetTradingStatus,
  useGetTrades,
  useHealthCheck,
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
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 12_000, refetchOnWindowFocus: true, retry: 1 } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#286c52',
    colorForeground: '#202a36',
    colorMutedForeground: '#66717d',
    colorDanger: '#b74940',
    colorBackground: '#f7f5ef',
    colorInput: '#fcfbf7',
    colorInputForeground: '#202a36',
    colorNeutral: '#d8d5cb',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.65rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f7f5ef] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d8d5cb]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#202a36] font-semibold',
    headerSubtitle: 'text-[#66717d]',
    socialButtonsBlockButtonText: 'text-[#202a36] font-medium',
    formFieldLabel: 'text-[#384550] font-medium',
    footerActionLink: 'text-[#286c52] font-semibold',
    footerActionText: 'text-[#66717d]',
    dividerText: 'text-[#66717d]',
    identityPreviewEditButton: 'text-[#286c52]',
    formFieldSuccessText: 'text-[#286c52]',
    alertText: 'text-[#7f332d]',
    logoBox: 'mb-3',
    logoImage: 'max-h-9',
    socialButtonsBlockButton: 'border-[#d8d5cb] bg-[#fcfbf7]',
    formButtonPrimary: 'bg-[#286c52] hover:bg-[#205d46] text-white shadow-none',
    formFieldInput: 'bg-[#fcfbf7] border-[#d8d5cb] text-[#202a36]',
    footerAction: 'border-t border-[#d8d5cb]',
    dividerLine: 'bg-[#d8d5cb]',
    alert: 'bg-[#f6e5e1] border-[#e9c4bd]',
    otpCodeFieldInput: 'bg-[#fcfbf7] border-[#d8d5cb]',
    formFieldRow: 'gap-1',
    main: 'gap-4',
  },
};

type IconType = typeof LayoutDashboard;
type PageTitle = { title: string; detail: string; icon: IconType };
const sections: { label: string; path: string; icon: IconType }[] = [
  { label: 'Overview', path: '/user-portal', icon: LayoutDashboard },
  { label: 'Strategies', path: '/strategies', icon: Crosshair },
  { label: 'Backtests', path: '/backtests', icon: FileChartColumn },
  { label: 'Activity', path: '/activity', icon: Activity },
  { label: 'Risk settings', path: '/settings', icon: Settings2 },
];
const pageTitles: Record<string, PageTitle> = {
  '/user-portal': { title: 'Overview', detail: 'Your paper account, at a glance.', icon: LayoutDashboard },
  '/strategies': { title: 'Strategies', detail: 'Configure rules. Keep risk explicit.', icon: Crosshair },
  '/backtests': { title: 'Backtests', detail: 'Evaluate on historical market data.', icon: FileChartColumn },
  '/activity': { title: 'Activity', detail: 'A complete, auditable paper-trading record.', icon: Activity },
  '/settings': { title: 'Risk settings', detail: 'Set limits before a strategy can run.', icon: Settings2 },
};

function fmt(value?: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function money(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
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

function Button({ children, variant = 'solid', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'outline' | 'ghost' | 'danger' }) {
  const variants = {
    solid: 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary',
    outline: 'border-border bg-card text-foreground hover:bg-muted',
    ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  return <button {...props} className={cx('inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)} />;
}
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={cx('panel', className)}>{children}</section>;
}
function PanelHeader({ title, aside, detail }: { title: string; aside?: ReactNode; detail?: string }) {
  return <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5"><div><h2 className="text-sm font-semibold tracking-[-.015em]">{title}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{aside}</div>;
}
function Skeleton({ className = '' }: { className?: string }) { return <div className={cx('skeleton rounded-md', className)} aria-label="Loading" />; }
function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return <Panel className="p-4"><Skeleton className="mb-5 h-4 w-36" />{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="mb-3 h-8 w-full" />)}</Panel>;
}
function QueryState({ loading, error, empty, retry, children }: { loading?: boolean; error?: boolean; empty?: boolean; retry?: () => void; children: ReactNode }) {
  if (loading) return <LoadingPanel />;
  if (error) return <Panel className="flex flex-col items-start gap-2 p-6"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} className="text-destructive" />Could not load this data</div><p className="text-xs text-muted-foreground">The API did not return a current snapshot. Nothing has been substituted.</p><Button variant="outline" onClick={retry}><RefreshCw size={14} />Try again</Button></Panel>;
  if (empty) return <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-10 text-center"><span className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground"><BookOpen size={16} /></span><p className="text-sm font-semibold">No records yet</p><p className="mt-1 text-xs text-muted-foreground">New activity will appear here when the API reports it.</p></div>;
  return <>{children}</>;
}
function TableWrap({ children }: { children: ReactNode }) { return <div className="overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>; }
function TableHead({ children }: { children: ReactNode }) { return <thead className="bg-muted/55 text-[10px] uppercase tracking-[.1em] text-muted-foreground">{children}</thead>; }
function EmptyCell({ children, colSpan }: { children: ReactNode; colSpan: number }) { return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</td></tr>; }
function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'neutral' }) {
  const tones = { good: 'bg-primary/10 text-primary', bad: 'bg-destructive/10 text-destructive', warn: 'bg-amber-100 text-amber-800', neutral: 'bg-muted text-muted-foreground' };
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[.07em]', tones[tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}
function MoneyValue({ value, currency = 'USD' }: { value?: number | null; currency?: string }) {
  return <span className={cx('font-mono-data tabular-nums', (value ?? 0) > 0 && 'text-primary', (value ?? 0) < 0 && 'text-destructive')}>{money(value, currency)}</span>;
}
function MiniChart({ candles = [], height = 190 }: { candles?: Candle[]; height?: number }) {
  if (!candles.length) return <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">No candle data returned for this interval.</div>;
  const closes = candles.map(c => c.close);
  const min = Math.min(...closes); const max = Math.max(...closes); const range = max - min || 1;
  const points = closes.map((n, i) => `${(i / Math.max(1, closes.length - 1)) * 100},${height - 15 - ((n - min) / range) * (height - 35)}`).join(' ');
  const fillPoints = `0,${height} ${points} 100,${height}`;
  return <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="Historical XRP candle close price chart">
    <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="hsl(153 44% 38%)" stopOpacity=".18" /><stop offset="100%" stopColor="hsl(153 44% 38%)" stopOpacity="0" /></linearGradient></defs>
    {[.25, .5, .75].map(y => <line key={y} x1="0" x2="100" y1={y * height} y2={y * height} stroke="hsl(var(--border))" strokeDasharray="1.5 2" vectorEffect="non-scaling-stroke" />)}
    <polygon points={fillPoints} fill="url(#chart-fill)" />
    <polyline points={points} fill="none" stroke="hsl(153 44% 38%)" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
  </svg>;
}
function Metric({ label, value, note, icon: Icon, tone = 'default' }: { label: string; value: ReactNode; note?: ReactNode; icon: IconType; tone?: 'default' | 'positive' | 'negative' }) {
  return <Panel className="relative overflow-hidden px-4 py-4"><div className="flex items-center justify-between"><span className="eyebrow">{label}</span><Icon size={15} className="text-muted-foreground" /></div><div className={cx('mt-3 font-display text-[26px] font-semibold leading-none tracking-[-.035em]', tone === 'positive' && 'text-primary', tone === 'negative' && 'text-destructive')}>{value}</div>{note && <div className="mt-2 text-[11px] text-muted-foreground">{note}</div>}</Panel>;
}
function PageHeading({ eyebrow = 'PAPER ENVIRONMENT', title, detail, action }: { eyebrow?: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow mb-2">{eyebrow}</div><h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">{title}</h1><p className="mt-1.5 text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
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

function Home() {
  const tickerParams = { symbol: 'XRP/USDT' };
  const ticker = useGetMarketTicker(tickerParams, { query: { queryKey: getGetMarketTickerQueryKey(tickerParams), refetchInterval: 30_000 } });
  const candleParams = { symbol: 'XRP/USDT', interval: '1h' as const, limit: 120 };
  const candleQuery = useGetMarketOhlcv(candleParams, { query: { queryKey: getGetMarketOhlcvQueryKey(candleParams), refetchInterval: 60_000 } });
  const health = useHealthCheck();
  const readiness = useGetReadiness();
  const [interval, setInterval] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
  const chartParams = { symbol: 'XRP/USDT', interval, limit: 120 };
  const chartQuery = useGetMarketOhlcv(chartParams, { query: { queryKey: getGetMarketOhlcvQueryKey(chartParams), refetchInterval: 60_000 } });
  const stream = useMarketStream('XRP/USDT', ticker.data);
  const market = stream.ticker;
  const bars = chartQuery.data ?? candleQuery.data ?? [];
  const ready = readiness.data?.status === 'ready';
  return <div className="min-h-[100dvh] bg-background">
    <header className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-5 md:px-9">
      <Link href="/" className="flex items-center gap-2.5" data-testid="link-brand-home"><BrandMark /><span className="text-[15px] font-bold tracking-[-.04em]">XRP <span className="font-medium text-muted-foreground">Quant</span></span></Link>
      <div className="flex items-center gap-2"><a href="#market" className="hidden px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground sm:block">Market data</a><Link href="/sign-in" className="rounded-md px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-create-account">Create account <ArrowRight size={13} className="ml-1 inline" /></Link></div>
    </header>
    <main className="mx-auto max-w-[1280px] px-5 pb-16 md:px-9">
      <section className="grid gap-8 pb-14 pt-11 md:grid-cols-[1.08fr_.92fr] md:items-center md:pb-20 md:pt-16">
        <div className="reveal">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Risk-first XRP research terminal</div>
          <h1 className="max-w-[700px] font-display text-[42px] font-semibold leading-[1.04] tracking-[-.055em] sm:text-[56px] md:text-[66px]">Measure the risk.<br /><span className="text-primary">Then make a move.</span></h1>
          <p className="mt-5 max-w-[525px] text-[15px] leading-7 text-muted-foreground">Real exchange market data, auditable paper execution, and strategy tests that show their work. No live orders. No guesswork hidden behind a headline number.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-start-evaluation">Start evaluating <ArrowRight size={15} /></Link><a href="#method" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-semibold hover:bg-muted">How it works <ArrowDownRight size={14} /></a></div>
          <div className="mt-7 flex items-center gap-3 text-[11px] text-muted-foreground"><ShieldCheck size={15} className="text-primary" />Paper-only execution <span className="h-1 w-1 rounded-full bg-border" /> Live trading disabled by design</div>
        </div>
    <Panel className="reveal overflow-hidden shadow-[0_20px_65px_-45px_hsl(218_27%_17%_/_0.35)]" >
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-primary"><TrendingUp size={14} /></span><div><p className="text-xs font-semibold">XRP / USDT</p><p className="eyebrow mt-0.5">{market?.exchange ?? 'Exchange ticker'}</p></div></div><StatusPill tone={market?.stale || stream.state !== 'live' ? 'warn' : 'good'}>{market?.stale ? 'Stale' : stream.state === 'live' ? 'Streaming' : 'Reconnecting'}</StatusPill></div>
          <div className="px-4 pb-4 pt-5"><div className="flex items-end justify-between"><div><p className="eyebrow">Last price</p><p className="mt-1 font-mono-data text-[30px] font-medium tracking-[-.04em]">{market ? `$${fmt(market.price, 4)}` : ticker.isLoading ? 'Loading' : '—'}</p></div><p className={cx('font-mono-data text-sm', (market?.changePct24h ?? 0) >= 0 ? 'text-primary' : 'text-destructive')}>{market ? percent(market.changePct24h) : '—'} <span className="text-[10px] text-muted-foreground">24H</span></p></div>
            <div className="mt-5 h-[190px]">{chartQuery.isLoading ? <Skeleton className="h-full w-full" /> : chartQuery.isError ? <QueryState error retry={() => chartQuery.refetch()}>{null}</QueryState> : <MiniChart candles={bars} />}</div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">{[['24h high', market ? `$${fmt(market.high24h, 4)}` : '—'], ['24h low', market ? `$${fmt(market.low24h, 4)}` : '—'], ['24h volume', market ? fmt(market.volume24h, 0) : '—']].map(([label, value]) => <div key={label}><p className="eyebrow">{label}</p><p className="mt-1 font-mono-data text-xs">{value}</p></div>)}</div>
            {market?.stale && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Ticker marked stale by exchange feed. Treat this quote as delayed.</p>}
          </div>
        </Panel>
      </section>
      <section id="market" className="border-y border-border py-7">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="eyebrow">Public market feed</div><p className="mt-1 text-sm font-semibold">XRP/USDT <span className="font-normal text-muted-foreground">· {market?.exchange ?? 'Exchange'} · updated {market ? dateTime(market.updatedAt) : '—'}</span></p></div><div className="flex gap-1 rounded-md border border-border bg-card p-1">{(['15m', '1h', '4h', '1d'] as const).map(item => <button key={item} onClick={() => setInterval(item)} className={cx('rounded px-3 py-1.5 font-mono-data text-[11px]', interval === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-interval-${item}`}>{item}</button>)}</div></div>
        {(health.data || readiness.data) && <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 rounded-full', health.data?.status === 'ok' ? 'bg-primary' : 'bg-amber-500')} />API {health.data?.status ?? 'checking'}</span><span className="inline-flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 rounded-full', ready ? 'bg-primary' : 'bg-amber-500')} />Market data {readiness.data?.marketData ?? 'checking'}</span><span className="inline-flex items-center gap-1.5"><LockKeyhole size={11} />Execution mode paper-only</span></div>}
      </section>
      <section id="method" className="grid gap-10 py-14 md:grid-cols-[.7fr_1.3fr] md:py-20">
        <div><div className="eyebrow">A better testing loop</div><h2 className="mt-3 max-w-sm font-display text-3xl font-semibold tracking-[-.04em]">Evidence before exposure.</h2><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Every signal, risk decision and paper fill is visible. A strategy has to earn its place.</p></div>
        <div className="grid gap-4 sm:grid-cols-3">{[{ n: '01', icon: BarChart3, h: 'Read the market', p: 'Use exchange ticker and OHLCV data with freshness surfaced.' }, { n: '02', icon: SlidersHorizontal, h: 'Set hard limits', p: 'Position, daily loss and drawdown controls are explicit.' }, { n: '03', icon: FileChartColumn, h: 'Test the thesis', p: 'Compare return, drawdown, trade count and equity curve.' }].map(item => <Panel key={item.n} className="p-4"><div className="flex items-center justify-between"><span className="font-mono-data text-xs text-primary">{item.n}</span><item.icon size={16} className="text-muted-foreground" /></div><h3 className="mt-7 text-sm font-semibold">{item.h}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.p}</p></Panel>)}</div>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-[10px] text-muted-foreground"><span>© XRP Quant · A paper research environment</span><span className="font-mono-data">LIVE TRADING: DISABLED</span></footer>
    </main>
  </div>;
}

function BrandMark() {
  return <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true"><path d="M5 5h14M5 19h14M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span>;
}
function PortalShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut } = useClerk();
  const { user } = useUser();
  const page = pageTitles[location] ?? pageTitles['/user-portal'];
  return <div className="min-h-[100dvh] bg-background">
    {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 md:hidden" onClick={() => setMobileOpen(false)} />}
    <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex h-[68px] items-center justify-between border-b border-sidebar-border px-5"><Link href="/user-portal" className="flex items-center gap-2.5" data-testid="link-sidebar-home"><BrandMark /><span className="text-sm font-bold tracking-[-.04em]">XRP <span className="font-medium text-sidebar-foreground/65">Quant</span></span></Link><button className="md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={16} /></button></div>
      <div className="px-4 pt-6"><p className="eyebrow !text-sidebar-foreground/45">Workspace</p><nav className="mt-2 space-y-1">{sections.map(item => {
        const Icon = item.icon; const active = location === item.path;
        return <Link key={item.path} href={item.path} onClick={() => setMobileOpen(false)} className={cx('flex h-10 items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors', active ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/65 hover:text-sidebar-foreground')} data-testid={`nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} className={active ? 'text-sidebar-primary' : ''} />{item.label}{item.path === '/settings' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}</Link>;
      })}</nav></div>
      <div className="mt-auto p-4"><div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-sidebar-primary/15 text-sidebar-primary"><ShieldCheck size={15} /></span><span className="text-xs font-semibold">Paper environment</span></div><p className="mt-2 text-[10px] leading-4 text-sidebar-foreground/55">No live orders can be placed from this workspace.</p><div className="mt-3 flex items-center gap-1.5 font-mono-data text-[9px] uppercase tracking-[.08em] text-sidebar-primary"><span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />Live trading off</div></div>
        <button onClick={() => signOut({ redirectUrl: basePath || '/' })} className="mt-4 flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-sign-out"><LogOut size={14} />Sign out</button>
      </div>
    </aside>
    <div className="min-h-[100dvh] md:pl-[236px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><button className="grid h-8 w-8 place-items-center rounded-md border border-border md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={16} /></button><div className="hidden h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground sm:grid"><page.icon size={14} /></div><div><p className="text-xs font-semibold">{page.title}</p><p className="hidden text-[10px] text-muted-foreground sm:block">{page.detail}</p></div></div>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" />PAPER MODE</div><button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Open activity" title="Open activity" onClick={() => setLocation('/activity')}><Bell size={15} /></button><div className="grid h-8 w-8 place-items-center rounded-full border border-border bg-accent text-[10px] font-bold text-primary" title={user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'Account'}>{(user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? 'Q').toUpperCase()}</div><div className="hidden max-w-[140px] truncate text-xs font-medium lg:block">{user?.firstName ?? 'Researcher'}<ChevronDown size={12} className="ml-1 inline text-muted-foreground" /></div></div>
      </header>
      <main className="page-enter mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-4 text-[9px] text-muted-foreground md:px-8"><span>Market data and strategy results are informational. Paper execution only.</span><span className="font-mono-data tracking-[.08em]">XRPQ / SYSTEM STATUS NOMINAL</span></footer>
    </div>
  </div>;
}
function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/user-portal" /></Show><Show when="signed-out"><Home /></Show></>;
}
function Guard({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function SignInPage() { return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><div className="w-full"><div className="mb-5 text-center"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold"><BrandMark />XRP Quant</Link></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>; }
function SignUpPage() { return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><div className="w-full"><div className="mb-5 text-center"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold"><BrandMark />XRP Quant</Link></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>; }

function Overview() {
  const dashboard = useGetTradingDashboard({ query: { queryKey: getGetTradingDashboardQueryKey(), refetchInterval: 15_000 } });
  const portfolio = useGetPortfolio({ query: { queryKey: getGetPortfolioQueryKey(), refetchInterval: 15_000 } });
  const status = useGetTradingStatus({ query: { queryKey: getGetTradingStatusQueryKey(), refetchInterval: 7_500 } });
  const data = dashboard.data;
  const marketStream = useMarketStream(data?.ticker.symbol ?? 'XRP/USDT', data?.ticker);
  const market = marketStream.ticker;
  const p = portfolio.data ?? data?.portfolio;
  const tradeCount = data?.stats.totalTrades;
  const refresh = () => { void dashboard.refetch(); void portfolio.refetch(); void status.refetch(); };
  if (dashboard.isLoading && !data) return <div className="space-y-4"><Skeleton className="h-10 w-60" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><LoadingPanel rows={5} /></div>;
  if (dashboard.isError && !data) return <QueryState error retry={refresh}>{null}</QueryState>;
  return <div>
    <PageHeading title="Overview" detail="A clear read on current market conditions and paper account exposure." action={<Button variant="outline" onClick={refresh} data-testid="button-refresh-overview"><RefreshCw size={14} />Refresh snapshot</Button>} />
    {(market?.stale || dashboard.isError) && <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900"><ShieldAlert size={14} />{market?.stale ? `Ticker data is marked stale. Last update ${dateTime(market.updatedAt)}.` : 'Dashboard refresh failed; displaying the last successful API snapshot.'}</div>}
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Paper equity" value={p ? money(p.equity, p.quoteCurrency) : '—'} note={p ? `Available ${money(p.availableBalance, p.quoteCurrency)}` : 'Awaiting portfolio snapshot'} icon={Gauge} />
      <Metric label="Daily P&L" value={p ? money(p.dayPnl, p.quoteCurrency) : '—'} note={p ? `${p.openPositions.length} open positions` : undefined} icon={p?.dayPnl && p.dayPnl >= 0 ? ArrowUpRight : ArrowDownRight} tone={(p?.dayPnl ?? 0) > 0 ? 'positive' : (p?.dayPnl ?? 0) < 0 ? 'negative' : 'default'} />
      <Metric label="Win rate" value={data ? `${fmt(data.stats.winRate)}%` : '—'} note={tradeCount != null ? `${tradeCount} closed paper trades` : 'No performance snapshot'} icon={Crosshair} />
      <Metric label="Max drawdown" value={data ? `${fmt(data.stats.maxDrawdownPct)}%` : '—'} note="From reported strategy history" icon={ShieldAlert} tone={(data?.stats.maxDrawdownPct ?? 0) > 0 ? 'negative' : 'default'} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.55fr_.85fr]">
      <div className="space-y-4">
        <Panel className="overflow-hidden"><PanelHeader title="Market snapshot" detail={`${market?.symbol ?? 'XRP/USDT'} · ${market?.exchange ?? 'market feed'} · Updated ${dateTime(market?.updatedAt)}`} aside={<StatusPill tone={market?.stale || marketStream.state !== 'live' ? 'warn' : 'good'}>{market?.stale ? 'Stale' : marketStream.state === 'live' ? 'Streaming' : 'Reconnecting'}</StatusPill>} />
          {market ? <div className="grid gap-4 p-4 sm:grid-cols-[1.1fr_1fr]"><div><p className="eyebrow">Last price</p><p className="mt-1 font-mono-data text-3xl">{money(market.price)}</p><p className={cx('mt-1 font-mono-data text-xs', market.changePct24h >= 0 ? 'text-primary' : 'text-destructive')}>{percent(market.changePct24h)} <span className="text-muted-foreground">24h change</span></p></div><div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">{[['24h high', money(market.high24h)], ['24h low', money(market.low24h)], ['24h volume', fmt(market.volume24h, 0)], ['Move', money(market.change24h)]].map(([label, value]) => <div key={label}><p className="eyebrow">{label}</p><p className="mt-1 font-mono-data text-xs">{value}</p></div>)}</div></div> : <div className="p-5 text-sm text-muted-foreground">No ticker snapshot returned.</div>}</Panel>
        <Panel><PanelHeader title="Recent trades" detail="Closed paper positions" aside={<Link href="/activity" className="text-xs font-semibold text-primary hover:underline">All activity <ArrowRight size={12} className="ml-1 inline" /></Link>} />
          <TableWrap><TableHead><tr>{['Instrument', 'Strategy', 'Net P&L', 'Exit', 'Closed'].map(col => <th key={col} className="px-4 py-2.5 font-medium">{col}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{data?.recentTrades?.slice(0, 5).map(t => <tr key={t.id} data-testid={`row-recent-trade-${t.id}`}><td className="px-4 py-3 font-semibold">{t.symbol}</td><td className="px-4 py-3 text-muted-foreground">{t.strategyName}</td><td className="px-4 py-3"><MoneyValue value={t.netPnl} /></td><td className="px-4 py-3 text-muted-foreground">{t.exitReason}</td><td className="px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(t.closedAt)}</td></tr>)}{(!data?.recentTrades?.length) && <EmptyCell colSpan={5}>No closed trades in the current snapshot.</EmptyCell>}</tbody></TableWrap>
        </Panel>
      </div>
      <div className="space-y-4">
        <PaperControlCard />
        <Panel><PanelHeader title="Latest signals" detail="Signal decisions with risk outcomes" aside={<Link href="/activity" className="text-xs font-semibold text-primary">View all <ArrowRight size={12} className="ml-1 inline" /></Link>} />
          <div className="divide-y divide-border">{data?.recentSignals?.length ? data.recentSignals.slice(0, 5).map(signal => <div key={signal.id} className="flex items-start gap-3 px-4 py-3" data-testid={`signal-${signal.id}`}><span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md', signal.side === 'buy' ? 'bg-primary/10 text-primary' : signal.side === 'sell' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}><Zap size={14} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{signal.side.toUpperCase()} · {signal.symbol}</span><StatusPill tone={signal.riskApproved ? 'good' : 'bad'}>{signal.riskApproved ? 'Approved' : 'Blocked'}</StatusPill></div><p className="mt-1 truncate text-[11px] text-muted-foreground">{signal.message}</p><p className="mt-1 font-mono-data text-[9px] text-muted-foreground">{signal.strategyName} · {fmt(signal.confidence * 100, 0)}% confidence</p></div></div>) : <div className="px-4 py-8 text-center text-xs text-muted-foreground">No signals reported.</div>}</div>
        </Panel>
      </div>
    </div>
  </div>;
}

function PaperControlCard() {
  const queryClient = useQueryClient();
  const status = useGetTradingStatus();
  const strategies = useGetStrategies();
  const start = useStartPaperTrading({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetTradingStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetTradingDashboardQueryKey() });
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
  const state = status.data?.state ?? 'stopped';
  const error = start.error || stop.error || emergency.error;
  return <Panel className="overflow-hidden"><PanelHeader title="Paper execution" detail="Execution controls affect paper orders only" aside={<StatusPill tone={state === 'running' ? 'good' : state === 'halted' ? 'bad' : 'neutral'}>{state}</StatusPill>} />
    <div className="space-y-3 p-4"><div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2.5"><div><p className="text-xs font-semibold">{status.data?.activeStrategyId ? strategies.data?.find(s => s.id === status.data?.activeStrategyId)?.name ?? 'Strategy active' : 'No active strategy'}</p><p className="mt-1 text-[10px] text-muted-foreground">{status.data?.message ?? 'Choose a strategy to begin paper evaluation.'}</p></div><span className="font-mono-data text-[9px] text-muted-foreground">SIM</span></div>
      {state !== 'running' && <div className="flex gap-2"><select value={strategyId} onChange={e => setStrategyId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" aria-label="Paper strategy" data-testid="select-paper-strategy"><option value="">Select strategy</option>{strategies.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Button disabled={!strategyId || start.isPending} onClick={() => start.mutate({ data: { strategyId } })} data-testid="button-start-paper">{start.isPending ? 'Starting…' : 'Start'}</Button></div>}
      {state === 'running' && <Button variant="outline" className="w-full" disabled={stop.isPending} onClick={() => stop.mutate()} data-testid="button-stop-paper">{stop.isPending ? 'Stopping…' : 'Stop new orders'}</Button>}
      {state !== 'halted' && <Button variant="danger" className="w-full" disabled={emergency.isPending} onClick={() => { if (window.confirm('Emergency stop paper trading? This halts all new orders.')) emergency.mutate(); }} data-testid="button-emergency-stop"><ShieldAlert size={14} />{emergency.isPending ? 'Halting…' : 'Emergency stop'}</Button>}
      {error && <div className="text-xs text-destructive">Action failed. Confirm current API status and retry.</div>}
      <div className="flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground"><span>Live trading</span><span className="font-semibold uppercase tracking-[.08em] text-muted-foreground">Disabled</span></div>
      {(start.isSuccess || stop.isSuccess || emergency.isSuccess) && <p className="text-[10px] font-medium text-primary" role="status">Paper trading status updated successfully.</p>}
    </div>
  </Panel>;
}

const strategyDefaults: StrategyInput = {
  name: 'EMA / RSI observation', symbol: 'XRP/USDT', interval: '1h', type: 'ema_crossover',
  params: { fastEma: 12, slowEma: 26, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, macdFast: 12, macdSlow: 26, macdSignal: 9, bollingerPeriod: 20, bollingerStdDev: 2 },
  stopLossPct: 2.5, takeProfitPct: 4, trailingStopPct: null, maxPositionPct: 10, maxDailyLossPct: 3, maxTradesPerDay: 6, cooldownSeconds: 300, minConfidence: 0.6,
};
const strategyNumericFields: { key: keyof StrategyInput; label: string; suffix?: string; step?: string }[] = [
  { key: 'stopLossPct', label: 'Stop loss', suffix: '%', step: '.1' }, { key: 'takeProfitPct', label: 'Take profit', suffix: '%', step: '.1' },
  { key: 'trailingStopPct', label: 'Trailing stop', suffix: '%', step: '.1' }, { key: 'maxPositionPct', label: 'Position cap', suffix: '%', step: '.1' },
  { key: 'maxDailyLossPct', label: 'Daily loss cap', suffix: '%', step: '.1' }, { key: 'maxTradesPerDay', label: 'Trades / day', step: '1' },
  { key: 'cooldownSeconds', label: 'Cooldown', suffix: 'sec', step: '1' }, { key: 'minConfidence', label: 'Min confidence', step: '.01' },
];
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
function StrategyDialog({ strategy, onClose }: { strategy?: Strategy; onClose: () => void }) {
  const queryClient = useQueryClient();
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
  function field<K extends keyof StrategyInput>(key: K, value: StrategyInput[K]) { setForm(v => ({ ...v, [key]: value })); }
  function paramField<K extends keyof StrategyInput['params']>(key: K, value: StrategyInput['params'][K]) {
    setForm(v => ({ ...v, params: { ...v.params, [key]: value } }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (strategy) update.mutate({ id: strategy.id, data: form }, { onSuccess: onClose });
    else create.mutate({ data: form }, { onSuccess: onClose });
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="strategy-dialog-title">
    <form onSubmit={submit} className="max-h-[92dvh] w-full max-w-[720px] overflow-y-auto rounded-t-xl border border-border bg-card shadow-xl sm:rounded-xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4"><div><p className="eyebrow">{strategy ? 'Configuration' : 'New configuration'}</p><h2 id="strategy-dialog-title" className="mt-1 text-lg font-semibold">{strategy ? 'Edit strategy' : 'Create strategy'}</h2></div><button type="button" onClick={onClose} aria-label="Close form" className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"><X size={16} /></button></div>
      <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
        <label className="space-y-1.5 sm:col-span-2"><span className="eyebrow">Strategy name</span><input required maxLength={80} value={form.name} onChange={e => field('name', e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="input-strategy-name" /></label>
        <label className="space-y-1.5"><span className="eyebrow">Symbol</span><input required value={form.symbol} onChange={e => field('symbol', e.target.value.toUpperCase())} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid="input-strategy-symbol" /></label>
        <label className="space-y-1.5"><span className="eyebrow">Interval</span><select value={form.interval} onChange={e => field('interval', e.target.value as StrategyInput['interval'])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-strategy-interval">{['1m', '5m', '15m', '1h', '4h', '1d'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="space-y-1.5 sm:col-span-2"><span className="eyebrow">Signal model</span><select value={form.type} onChange={e => field('type', e.target.value as StrategyInput['type'])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-strategy-type">{[['ema_crossover', 'EMA crossover'], ['rsi_reversion', 'RSI reversion'], ['macd', 'MACD'], ['bollinger', 'Bollinger bands'], ['combined', 'Combined indicators']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="eyebrow sm:col-span-2">Indicator parameters</div>
        {indicatorFields.map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><input type="number" required min={item.min} max={item.max} step={item.step ?? 1} value={form.params[item.key]} onChange={e => paramField(item.key, Number(e.target.value))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid={`input-indicator-${item.key}`} /></label>)}
        <div className="eyebrow sm:col-span-2">Risk controls and limits</div>
        {strategyNumericFields.map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><div className="relative"><input type="number" min={item.key === 'minConfidence' || item.key === 'trailingStopPct' ? 0 : 0.01} max={item.key === 'minConfidence' ? 1 : item.key === 'maxTradesPerDay' ? 1000 : item.key === 'cooldownSeconds' ? 86400 : 100} step={item.step ?? 'any'} value={form[item.key] == null ? '' : String(form[item.key])} onChange={e => field(item.key, (e.target.value === '' && item.key === 'trailingStopPct' ? null : Number(e.target.value)) as never)} className="h-10 w-full rounded-md border border-input bg-background px-3 pr-10 font-mono-data text-sm" data-testid={`input-${String(item.key)}`} />{item.suffix && <span className="absolute right-3 top-3 text-[10px] text-muted-foreground">{item.suffix}</span>}</div></label>)}
        <p className="text-[11px] leading-5 text-muted-foreground sm:col-span-2">Indicator periods and thresholds are stored with this strategy. EMA and MACD fast periods must remain below their slow periods.</p>
        {(create.error || update.error) && <p className="text-xs text-destructive sm:col-span-2">Could not save this strategy. Check field limits and retry.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-strategy">{busy ? 'Saving…' : strategy ? 'Save changes' : 'Create strategy'}</Button></div>
    </form>
  </div>;
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
    {update.isError && <p className="mt-3 text-xs text-destructive">Could not update the strategy. Try again.</p>}
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
  const strategies = useGetStrategies();
  const backtests = useGetBacktests();
  const run = useRunBacktest({ mutation: { onSuccess: result => {
    queryClient.setQueryData(getGetBacktestQueryKey(result.id), result);
    void queryClient.invalidateQueries({ queryKey: getGetBacktestsQueryKey() });
  } } });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<BacktestInput>({ strategyId: '', symbol: 'XRP/USDT', interval: '1h', days: 90, initialCapital: 10000, feeBps: 10, slippageBps: 5 });
  const selectedQuery = useGetBacktest(selectedId, { query: { enabled: Boolean(selectedId), queryKey: getGetBacktestQueryKey(selectedId) } });
  const result = (run.data ?? selectedQuery.data) as Backtest | undefined;
  const [recentClick, setRecentClick] = useState(false);
  useEffect(() => {
    if (!form.strategyId && strategies.data?.[0]) setForm(v => ({ ...v, strategyId: strategies.data?.[0].id ?? '' }));
  }, [form.strategyId, strategies.data]);
  function submit(e: FormEvent) { e.preventDefault(); setRecentClick(false); run.mutate({ data: form }); }
  return <div>
    <PageHeading title="Backtests" detail="Run historical tests using exchange candles, then inspect the equity path and each outcome." />
    <div className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]">
      <Panel className="h-fit overflow-hidden"><PanelHeader title="Test parameters" detail="Every run uses real historical market data." />
        <form className="space-y-4 p-4" onSubmit={submit}>
          <label className="block space-y-1.5"><span className="eyebrow">Strategy</span><select required value={form.strategyId} onChange={e => setForm(v => ({ ...v, strategyId: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-backtest-strategy"><option value="">Choose strategy</option>{strategies.data?.map(s => <option key={s.id} value={s.id}>{s.name} · {s.symbol}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5"><span className="eyebrow">Symbol</span><input value={form.symbol} onChange={e => setForm(v => ({ ...v, symbol: e.target.value.toUpperCase() }))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid="input-backtest-symbol" /></label><label className="space-y-1.5"><span className="eyebrow">Candle interval</span><select value={form.interval} onChange={e => setForm(v => ({ ...v, interval: e.target.value as BacktestInput['interval'] }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-backtest-interval">{['1m', '5m', '15m', '1h', '4h', '1d'].map(v => <option key={v}>{v}</option>)}</select></label></div>
          <div className="grid grid-cols-2 gap-3">{[{ key: 'days', label: 'Historical days', min: 1, max: 365, step: 1 }, { key: 'initialCapital', label: 'Paper capital', min: 1, max: 1000000000, step: 100 }, { key: 'feeBps', label: 'Fee (bps)', min: 0, max: 100, step: 1 }, { key: 'slippageBps', label: 'Slippage (bps)', min: 0, max: 100, step: 1 }].map(item => <label key={item.key} className="space-y-1.5"><span className="eyebrow">{item.label}</span><input type="number" required min={item.min} max={item.max} step={item.step} value={form[item.key as keyof BacktestInput]} onChange={e => setForm(v => ({ ...v, [item.key]: Number(e.target.value) }))} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono-data text-sm" data-testid={`input-backtest-${item.key}`} /></label>)}</div>
          <Button type="submit" className="w-full" disabled={run.isPending || !form.strategyId} data-testid="button-run-backtest"><BarChart3 size={14} />{run.isPending ? 'Evaluating history…' : 'Run backtest'}</Button>
          {run.isError && <p className="text-xs text-destructive">Backtest could not run. Confirm the symbol, interval and selected strategy.</p>}
          {run.isSuccess && <p className="text-xs font-medium text-primary" role="status">Run complete. Metrics below reflect the returned result.</p>}
        </form>
      </Panel>
      <div className="space-y-4">
        {result ? <BacktestResult result={result} /> : <Panel className="flex min-h-[290px] flex-col items-center justify-center px-6 py-12 text-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-primary"><FileChartColumn size={18} /></span><h2 className="mt-4 text-sm font-semibold">A result with context</h2><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Choose a configured strategy to run the historical evaluation. Drawdown and trade count sit beside return.</p></Panel>}
        <Panel><PanelHeader title="Recent runs" detail="Select a completed backtest to inspect its metrics." aside={<Button variant="ghost" className="min-h-7 px-2 text-[10px]" onClick={() => void backtests.refetch()}><RefreshCw size={12} />Refresh</Button>} />
          {backtests.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" /></div> : backtests.isError && !backtests.data ? <div className="p-4 text-xs text-destructive">Backtest history unavailable. <button className="underline" onClick={() => void backtests.refetch()}>Retry</button></div> : backtests.data?.length ? <div className="divide-y divide-border">{backtests.data.slice(0, 6).map(b => <button key={b.id} onClick={() => { setSelectedId(b.id); setRecentClick(true); }} className={cx('flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40', selectedId === b.id && recentClick && 'bg-accent/50')} data-testid={`button-backtest-${b.id}`}><div><p className="text-xs font-semibold">{b.strategyName}</p><p className="mt-1 font-mono-data text-[9px] text-muted-foreground">{b.symbol} · {b.interval} · {dateTime(b.createdAt)}</p></div><div className="text-right"><p className={cx('font-mono-data text-xs', b.totalReturnPct >= 0 ? 'text-primary' : 'text-destructive')}>{percent(b.totalReturnPct)}</p><p className="mt-1 text-[9px] text-muted-foreground">{b.tradeCount} trades</p></div></button>)}</div> : <div className="px-4 py-8 text-center text-xs text-muted-foreground">No previous runs.</div>}
        </Panel>
      </div>
    </div>
  </div>;
}
function BacktestResult({ result: b }: { result: Backtest }) {
  return <Panel className="overflow-hidden"><PanelHeader title="Evaluation result" detail={`${b.strategyName} · ${b.symbol} · ${b.interval}`} aside={<StatusPill tone="good">Completed</StatusPill>} />
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

function ActivityPage() {
  const [tab, setTab] = useState('Trades');
  const trades = useGetTrades({ limit: 100 });
  const orders = useGetOrders({ limit: 100 });
  const positions = useGetPositions();
  const signals = useGetSignals({ limit: 100 });
  const [filter, setFilter] = useState('');
  const tabs = ['Trades', 'Orders', 'Positions', 'Signals'];
  return <div>
    <PageHeading title="Activity" detail="Trade, order, position and signal records from paper execution." action={<label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter symbol…" className="h-9 w-[190px] rounded-md border border-input bg-card pl-9 pr-3 text-xs" data-testid="input-activity-filter" /></label>} />
    <Panel className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 pt-3"><div className="flex gap-1">{tabs.map(item => <button key={item} onClick={() => setTab(item)} className={cx('relative px-3 py-2.5 text-xs font-semibold', tab === item ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} data-testid={`tab-${item.toLowerCase()}`}>{item}{tab === item && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />}</button>)}</div><Button variant="ghost" className="min-h-7 text-[10px]" onClick={() => { void trades.refetch(); void orders.refetch(); void positions.refetch(); void signals.refetch(); }}><RefreshCw size={12} />Refresh</Button></div>
      {tab === 'Trades' && <ActivityQuery query={trades} retry={() => void trades.refetch()} empty={!trades.data?.length}><TableWrap><TableHead><tr>{['Symbol', 'Strategy', 'Entry → exit', 'Net P&L', 'Exit reason', 'Closed'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{trades.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(t => <tr key={t.id} data-testid={`row-trade-${t.id}`}><td className="px-4 py-3 font-semibold">{t.symbol}</td><td className="px-4 py-3 text-muted-foreground">{t.strategyName}</td><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px]">{fmt(t.entryPrice, 4)} <ArrowRight size={11} className="mx-1 inline text-muted-foreground" />{fmt(t.exitPrice, 4)}</td><td className="px-4 py-3"><MoneyValue value={t.netPnl} /></td><td className="px-4 py-3 text-muted-foreground">{t.exitReason}</td><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(t.closedAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Orders' && <ActivityQuery query={orders} retry={() => void orders.refetch()} empty={!orders.data?.length}><TableWrap><TableHead><tr>{['Symbol', 'Side', 'Quantity', 'Fill price', 'Fee', 'Status', 'Created'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{orders.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(o => <tr key={o.id} data-testid={`row-order-${o.id}`}><td className="px-4 py-3 font-semibold">{o.symbol}</td><td className="px-4 py-3"><StatusPill tone={o.side === 'buy' ? 'good' : 'bad'}>{o.side}</StatusPill></td><td className="px-4 py-3 font-mono-data">{fmt(o.quantity, 4)}</td><td className="px-4 py-3 font-mono-data">{money(o.price)}</td><td className="px-4 py-3 font-mono-data">{money(o.fee)}</td><td className="px-4 py-3 text-muted-foreground">{o.status}</td><td className="px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(o.createdAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Positions' && <ActivityQuery query={positions} retry={() => void positions.refetch()} empty={!positions.data?.length}><TableWrap><TableHead><tr>{['Symbol', 'Strategy', 'Quantity', 'Entry', 'Mark', 'Unrealized P&L', 'Opened'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{positions.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(p => <tr key={p.id} data-testid={`row-position-${p.id}`}><td className="px-4 py-3 font-semibold">{p.symbol}</td><td className="px-4 py-3 text-muted-foreground">{p.strategyName}</td><td className="px-4 py-3 font-mono-data">{fmt(p.quantity, 4)}</td><td className="px-4 py-3 font-mono-data">{money(p.entryPrice)}</td><td className="px-4 py-3 font-mono-data">{money(p.markPrice)}</td><td className="px-4 py-3"><MoneyValue value={p.unrealizedPnl} /></td><td className="px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(p.openedAt)}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
      {tab === 'Signals' && <ActivityQuery query={signals} retry={() => void signals.refetch()} empty={!signals.data?.length}><TableWrap><TableHead><tr>{['Time', 'Instrument', 'Strategy', 'Side', 'Confidence', 'Risk outcome', 'Decision'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></TableHead><tbody className="divide-y divide-border text-xs">{signals.data?.filter(v => v.symbol.toLowerCase().includes(filter.toLowerCase())).map(s => <tr key={s.id} data-testid={`row-signal-${s.id}`}><td className="whitespace-nowrap px-4 py-3 font-mono-data text-[10px] text-muted-foreground">{dateTime(s.createdAt)}</td><td className="px-4 py-3 font-semibold">{s.symbol}</td><td className="px-4 py-3 text-muted-foreground">{s.strategyName}</td><td className="px-4 py-3"><StatusPill tone={s.side === 'buy' ? 'good' : s.side === 'sell' ? 'bad' : 'neutral'}>{s.side}</StatusPill></td><td className="px-4 py-3 font-mono-data">{fmt(s.confidence * 100, 0)}%</td><td className="px-4 py-3"><StatusPill tone={s.riskApproved ? 'good' : 'bad'}>{s.riskApproved ? 'Approved' : 'Blocked'}</StatusPill></td><td className="max-w-[280px] px-4 py-3 text-muted-foreground">{s.rejectionReason ?? s.message}</td></tr>)}</tbody></TableWrap></ActivityQuery>}
    </Panel>
  </div>;
}
function ActivityQuery({ query, retry, empty, children }: { query: { isLoading: boolean; isError: boolean; data?: unknown }; retry: () => void; empty: boolean; children: ReactNode }) {
  return <QueryState loading={query.isLoading} error={query.isError && !query.data} empty={empty} retry={retry}>{children}</QueryState>;
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
        {query.isLoading && !form ? <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div> : query.isError && !form ? <div className="p-4"><QueryState error retry={() => void query.refetch()}>{null}</QueryState></div> : form && <form onSubmit={submit}><div className="divide-y divide-border">{riskFields.map(item => <label key={item.key} className="flex items-center justify-between gap-4 px-4 py-3.5"><div><span className="text-xs font-semibold">{item.label}</span><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{item.detail}</p></div><div className="relative w-[110px] shrink-0"><input type="number" required min={0} step={item.step} value={form[item.key]} onChange={e => setForm(v => v ? ({ ...v, [item.key]: Number(e.target.value) }) : v)} className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-right font-mono-data text-xs" data-testid={`input-risk-${item.key}`} />{item.suffix && <span className="absolute right-3 top-2.5 text-[9px] text-muted-foreground">{item.suffix}</span>}</div></label>)}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-4 py-3"><p className="max-w-xs text-[10px] text-muted-foreground">Balance is read-only here; only server-supported risk settings can be changed.</p><Button type="submit" disabled={save.isPending || !form} data-testid="button-save-risk-settings">{save.isPending ? 'Saving…' : 'Save risk settings'}</Button></div>{save.isSuccess && <p className="px-4 py-3 text-xs font-medium text-primary" role="status">Risk settings saved successfully.</p>}{save.isError && <p className="px-4 py-3 text-xs text-destructive">Could not save risk settings. Verify each value is within API limits.</p>}</form>}
      </Panel>
      <Panel className="overflow-hidden"><PanelHeader title="Paper validation" detail="Readiness checks returned by the API" aside={validation.data && <StatusPill tone={validation.data.checks.some(c => c.status === 'blocked') ? 'bad' : validation.data.checks.every(c => c.status === 'passed') ? 'good' : 'warn'}>{validation.data.checks.some(c => c.status === 'blocked') ? 'Blocked' : validation.data.checks.every(c => c.status === 'passed') ? 'Ready' : 'Review'}</StatusPill>} />
        {validation.isLoading
          ? <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : validation.isError && !validation.data
            ? <div className="p-4"><QueryState error retry={() => void validation.refetch()}>{null}</QueryState></div>
            : validation.data?.checks.length
              ? <div className="divide-y divide-border">{validation.data.checks.map(check => <div key={check.id} className="flex gap-3 px-4 py-3.5" data-testid={`validation-${check.id}`}>
                  <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full', check.status === 'passed' ? 'bg-primary/10 text-primary' : check.status === 'blocked' ? 'bg-destructive/10 text-destructive' : 'bg-amber-100 text-amber-800')}>{check.status === 'passed' ? <Check size={13} /> : check.status === 'blocked' ? <X size={13} /> : <Clock3 size={13} />}</span>
                  <div className="flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{check.label}</p><StatusPill tone={check.status === 'passed' ? 'good' : check.status === 'blocked' ? 'bad' : 'warn'}>{check.status}</StatusPill></div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{check.detail}</p></div>
                </div>)}</div>
              : <div className="p-5 text-center text-xs text-muted-foreground">No validation checks returned.</div>}
        <div className="border-t border-border bg-muted/25 px-4 py-3"><div className="flex items-center justify-between"><span className="text-[11px] font-medium">Live trading status</span><span className="font-mono-data text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground">{validation.data?.liveTradingEnabled === false ? 'Disabled' : 'Not enabled'}</span></div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">This interface has no live-order controls. All execution actions are paper-only.</p></div>
      </Panel>
    </div>
  </div>;
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
function Routed() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to review your XRP paper workspace.' } }, signUp: { start: { title: 'Create your account', subtitle: 'Build a more disciplined XRP testing process.' } } }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <ClerkCacheInvalidator />
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/user-portal"><Guard><PortalShell><Overview /></PortalShell></Guard></Route>
      <Route path="/strategies"><Guard><PortalShell><StrategiesPage /></PortalShell></Guard></Route>
      <Route path="/backtests"><Guard><PortalShell><BacktestsPage /></PortalShell></Guard></Route>
      <Route path="/activity"><Guard><PortalShell><ActivityPage /></PortalShell></Guard></Route>
      <Route path="/settings"><Guard><PortalShell><SettingsPage /></PortalShell></Guard></Route>
      <Route><NotFound /></Route>
    </Switch>
  </ClerkProvider>;
}
function NotFound() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5 text-center"><div><p className="eyebrow">404 · NOT IN THIS LEDGER</p><h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">That route isn’t available.</h1><Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">Back to XRP Quant <ArrowRight size={14} /></Link></div></div>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><Routed /></WouterRouter></QueryClientProvider>;
}

export default App;