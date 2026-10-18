import { Check, Clock3, ExternalLink, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Link } from 'wouter';
import {
  useTradeBriefing,
  type BriefingFactor,
  type BriefingVerdict,
  type TradeBriefing,
} from './trade-briefing';
import type { MarketTicker } from '@workspace/api-client-react';
import { OpenAiPanel } from './openai-panel';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const tone: Record<BriefingVerdict, string> = {
  ready: 'bg-emerald-400',
  wait: 'bg-amber-400',
  blocked: 'bg-red-400',
};

function FactorRow({ factor }: { factor: BriefingFactor }) {
  const icon = factor.status === 'passed' ? <Check size={13} /> : factor.status === 'blocked' ? <X size={13} /> : <Clock3 size={13} />;
  const color = factor.status === 'passed' ? 'bg-primary/15 text-primary' : factor.status === 'blocked' ? 'bg-destructive/15 text-destructive' : 'bg-amber-100 text-amber-700';
  return (
    <div className="flex gap-3 px-4 py-3.5">
      <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full', color)}>{icon}</span>
      <div>
        <p className="text-xs font-semibold">{factor.label}</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{factor.detail}</p>
      </div>
    </div>
  );
}

function stat(value: number | null, digits = 2, suffix = '%') {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix}`;
}

export function AnalysisPage({ symbol, ticker }: { symbol: string; ticker?: MarketTicker }) {
  const { briefing, loading, error, refetch } = useTradeBriefing(symbol, ticker);

  if (loading && !briefing) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-44 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <div className="skeleton h-80 rounded-2xl" />
          <div className="skeleton h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <section className="panel flex flex-col items-start gap-2 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} className="text-destructive" />Could not load this data</div>
        <p className="text-xs text-muted-foreground">The start check needs a current account snapshot. Nothing has been substituted.</p>
        <button type="button" onClick={refetch} className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-semibold"><RefreshCw size={14} />Try again</button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl bg-[#0B1220] px-6 py-7 text-white md:px-8">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_40%,rgba(34,197,94,0.35),transparent_62%)]" />
        <div className="relative max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-200">AI analysis · paper start check</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-.04em] md:text-[34px]" data-testid="text-trade-briefing">{briefing.headline}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">{briefing.summary}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/user-portal" onClick={() => sessionStorage.setItem('xrpq-scroll-trading', '1')} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">{briefing.verdict === 'ready' ? 'Start on the desk' : 'Review trading'}</Link>
            <Link href="/strategies" className="inline-flex h-10 items-center rounded-lg border border-white/20 px-4 text-sm font-semibold text-white hover:bg-white/10">Strategies</Link>
          </div>
        </div>
      </section>

      <ActionCall briefing={briefing} />

      <OpenAiPanel briefing={briefing} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="24h move" value={briefing.stats.changePct24h == null ? '—' : `${briefing.stats.changePct24h >= 0 ? '+' : ''}${briefing.stats.changePct24h.toFixed(2)}%`} />
        <Metric label="24h range" value={stat(briefing.stats.rangePct)} />
        <Metric label="Hourly volatility" value={stat(briefing.stats.hourlyVolPct)} />
        <Metric label="Fear and greed" value={briefing.stats.fearValue == null ? '—' : String(briefing.stats.fearValue)} note={briefing.stats.fearLabel ?? 'Index unavailable'} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Why this verdict</h2>
              <p className="mt-1 text-xs text-muted-foreground">Each line uses the live desk, not a substituted score.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground"><span className={cx('h-2 w-2 rounded-full', tone[briefing.verdict])} />{briefing.verdict}</span>
          </div>
          <div className="divide-y divide-border">{briefing.factors.map(factor => <FactorRow key={factor.id} factor={factor} />)}</div>
        </section>

        <div className="space-y-4">
          <DeskStatusCard />
          <section className="panel overflow-hidden">
            <div className="border-b border-border px-4 py-3.5">
              <h2 className="text-sm font-semibold">Desk notes</h2>
              <p className="mt-1 text-xs text-muted-foreground">Written for this verdict so you can check the start decision.</p>
            </div>
            <div className="divide-y divide-border">
              {briefing.articles.filter(article => article.kind === 'note').map(article => (
                <article key={article.id} className="px-4 py-4">
                  <p className="eyebrow">{article.source} · {article.minutes} min</p>
                  <h3 className="mt-2 text-sm font-semibold">{article.title}</h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{article.summary}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-3.5">
          <h2 className="text-sm font-semibold">Related reading</h2>
          <p className="mt-1 text-xs text-muted-foreground">Outside references for the asset and the market mood. They are not trade signals.</p>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {briefing.articles.filter(article => article.kind === 'reference').map(article => (
            <a key={article.id} href={article.href} target="_blank" rel="noreferrer" className="bg-card px-4 py-4 hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">{article.source}</p>
                <ExternalLink size={13} className="text-muted-foreground" />
              </div>
              <h3 className="mt-2 text-sm font-semibold">{article.title}</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{article.summary}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActionCall({ briefing }: { briefing: TradeBriefing }) {
  const action = briefing.action;
  const tone = action.side === 'buy' && action.allowed
    ? 'border-primary/30 bg-primary/10 text-primary'
    : action.side === 'sell' && action.allowed
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : 'border-border bg-muted/40 text-foreground';
  return (
    <section className={cx('rounded-2xl border px-5 py-4', tone)} data-testid="text-action-call">
      <p className="text-[11px] font-semibold uppercase tracking-[.14em] opacity-70">Buy or sell</p>
      <h2 className="mt-1 font-display text-2xl font-semibold tracking-[-.03em]">{action.headline}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 opacity-80">{action.detail}</p>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <section className="panel border-t-2 border-t-primary px-4 py-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 font-display text-[26px] font-semibold leading-none tracking-[-.035em]">{value}</p>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

function DeskStatusCard() {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Desk status</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">The buy or sell call sits on the line under the header. It updates in place about once a minute. Windows does not raise a toast for it.</p>
    </section>
  );
}
