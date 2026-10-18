import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type TradeCost = {
  spendPct: number;
  spend: number;
  quantity: number;
  fillPrice: number;
  fee: number;
  slippage: number;
  total: number;
};

type DemoView = {
  active: boolean;
  hour: number;
  remainingHours: number;
  startedAt: string | null;
  endsAt: string | null;
  symbol: string;
  price: number;
  change24h: number;
  changePct24h: number;
  updatedAt: string;
  exchange: string;
  feeBps: number;
  slippageBps: number;
  costs: TradeCost[];
};

async function demoRequest(path: string, body?: unknown): Promise<DemoView> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as DemoView & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'The demo request failed.');
  return payload;
}

function usd(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function DemoPage({ onChange }: { onSymbol: (symbol: string) => void; onChange: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const demo = useQuery({
    queryKey: ['demo', 'status'],
    queryFn: () => demoRequest('/api/demo'),
    refetchInterval: 3_000,
  });

  async function run(label: string, path: string) {
    setBusy(label);
    setError('');
    try {
      await demoRequest(path, {});
      await demo.refetch();
      onChange();
      await client.invalidateQueries();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The demo request failed.');
    } finally {
      setBusy('');
    }
  }

  const status = demo.data;
  const active = Boolean(status?.active);
  const move = status?.changePct24h;
  const down = (move ?? 0) < 0;

  return (
    <div className="space-y-4">
      <div className="page-intro mb-2 px-5 py-5">
        <div className="eyebrow mb-2">1-day paper test</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Demo</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">XRP stays on the live exchange price. Virtual here means the paper trade cost: the fee plus slippage added on top of that real price. This test runs for one day and does not send a live order.</p>
      </div>

      <section className="relative overflow-hidden rounded-2xl bg-[#0B1220] px-6 py-7 text-white md:px-8">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_40%,rgba(34,197,94,0.28),transparent_62%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-200">Live price · {status?.symbol ?? 'XRP/USDT'}</p>
            <p className="mt-2 font-mono-data text-4xl font-semibold tracking-[-.04em]" data-testid="text-live-price">{usd(status?.price, 5)}</p>
            <p className={`mt-2 text-sm font-semibold ${move == null ? 'text-white/60' : down ? 'text-red-300' : 'text-emerald-300'}`}>
              {move == null ? 'Waiting for the live quote' : `${status && status.change24h < 0 ? '' : '+'}${usd(status?.change24h, 5)} USD · ${move >= 0 ? '+' : ''}${move.toFixed(2)}%`}
            </p>
            <p className="mt-1 text-[11px] text-white/50">{status?.exchange ?? 'binance'} · {status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : '—'}</p>
          </div>
          <div className="min-w-[220px]">
            <div className="flex items-center justify-between text-[11px] text-white/60">
              <span>{active ? '1-day paper test' : 'Not started'}</span>
              <span>{active ? `${status?.remainingHours.toFixed(1)}h left` : '24h'}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-300" style={{ width: `${active ? Math.min(100, (status?.hour ?? 0) / 24 * 100) : 0}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-white/50">{active ? `Hour ${status?.hour.toFixed(2)} of 24. The quote stays live.` : 'Start the test when you want a one-day paper session.'}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3.5">
            <h2 className="text-sm font-semibold">Virtual trade cost</h2>
            <p className="mt-1 text-xs text-muted-foreground">Fee {status ? (status.feeBps / 100).toFixed(2) : '—'}% · slippage {status ? (status.slippageBps / 100).toFixed(2) : '—'}%. Charged on the live price, in paper cash.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-[.06em] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-semibold">Spend</th>
                  <th className="px-4 py-2 font-semibold">XRP</th>
                  <th className="px-4 py-2 font-semibold">Fee</th>
                  <th className="px-4 py-2 font-semibold">Slippage</th>
                  <th className="px-4 py-2 font-semibold">Virtual cost</th>
                </tr>
              </thead>
              <tbody>
                {(status?.costs ?? []).map(row => (
                  <tr key={row.spendPct} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-semibold">{row.spendPct}% · {usd(row.spend)} USDT</td>
                    <td className="px-4 py-3 font-mono-data">{usd(row.quantity, 4)}</td>
                    <td className="px-4 py-3 font-mono-data">{usd(row.fee, 4)}</td>
                    <td className="px-4 py-3 font-mono-data">{usd(row.slippage, 4)}</td>
                    <td className="px-4 py-3 font-mono-data font-semibold">{usd(row.total, 4)} USDT</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border bg-muted/25 px-4 py-3">
            {active ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void run('stop', '/api/demo/stop')} className="inline-flex min-h-9 items-center rounded-md border border-destructive px-3 text-[13px] font-semibold text-destructive disabled:opacity-50" data-testid="button-demo-stop">{busy === 'stop' ? 'Stopping…' : 'Stop 1-day test'}</button>
            ) : (
              <button type="button" disabled={Boolean(busy)} onClick={() => void run('start', '/api/demo/start')} className="inline-flex min-h-9 items-center rounded-md border border-primary bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="button-demo-start">{busy === 'start' ? 'Starting…' : 'Start 1-day test'}</button>
            )}
          </div>
          {error && <p className="border-t border-border px-4 py-3 text-xs text-destructive">{error}</p>}
        </section>

        <section className="panel px-4 py-4">
          <h2 className="text-sm font-semibold">What stays real</h2>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
            <li>The header, chart, and analysis use the live XRP price.</li>
            <li>A paper buy fills at that price plus slippage, then pays the fee. Those two amounts are the virtual trade cost.</li>
            <li>The one-day clock only marks how long this paper test has been running.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
