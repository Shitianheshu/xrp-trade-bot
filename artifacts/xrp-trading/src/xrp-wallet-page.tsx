import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, LogOut, RefreshCw } from 'lucide-react';

type LedgerAccount = {
  address: string;
  funded: boolean;
  balanceXrp: number;
  spendableXrp: number;
  reserveXrp: number;
  sequence: number | null;
  requireDestinationTag: boolean;
};

type LedgerTransfer = {
  hash: string;
  direction: 'sent' | 'received' | 'other';
  counterparty: string;
  amountXrp: number | null;
  destinationTag: number | null;
  result: string;
};

type WalletKind = 'metamask' | 'trust' | 'gemwallet' | 'crossmark';
type Action = 'send' | 'receive' | 'swap';

type Eip1193 = {
  isMetaMask?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  providers?: Eip1193[];
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

type CrossmarkNetwork = { wss?: string; rpc?: string; label?: string; protocol?: string };
type CrossmarkApi = {
  signInAndWait?: () => Promise<unknown>;
  signAndSubmitAndWait?: (tx: Record<string, unknown>) => Promise<unknown>;
  signAndSubmit?: (tx: Record<string, unknown>) => Promise<unknown>;
  async?: { signInAndWait?: () => Promise<unknown>; signAndSubmitAndWait?: (tx: Record<string, unknown>) => Promise<unknown> };
  methods?: { signInAndWait?: () => Promise<unknown>; signAndSubmitAndWait?: (tx: Record<string, unknown>) => Promise<unknown>; getAddress?: () => string | undefined; getNetwork?: () => CrossmarkNetwork | undefined };
  session?: { address?: string; network?: CrossmarkNetwork };
};

const fieldClass = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary';
const ADDRESS_KEY = 'xrpq-ledger-address';
const WALLET_KEY = 'xrpq-ledger-wallet';
const TRUST_ACCOUNT_KEY = 'xrpq-trust-account';
const SNAP_ID = 'npm:xrpl-snap';
const XRP_ASSET = 'c144';
const USDC_ASSET = 'c60_t0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function xrp(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function usd(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function short(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function walletLabel(kind: WalletKind) {
  if (kind === 'metamask') return 'MetaMask';
  if (kind === 'trust') return 'Trust Wallet';
  if (kind === 'gemwallet') return 'GemWallet';
  return 'Crossmark';
}

function providerMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (/reject/i.test(message)) return 'The extension closed before it was approved.';
  return message || 'The extension did not finish the request.';
}

function browserProviders(): Eip1193[] {
  const root = window as Window & { ethereum?: Eip1193; trustwallet?: Eip1193 };
  const list = [root.trustwallet, ...(root.ethereum?.providers ?? []), root.ethereum].filter((item): item is Eip1193 => Boolean(item));
  return list.filter((item, index) => list.indexOf(item) === index);
}

let announcedTrust: Eip1193 | null = null;

function rememberTrustProvider(provider: Eip1193 | null | undefined) {
  if (provider) announcedTrust = provider;
}

function trustProvider(): Eip1193 | null {
  if (announcedTrust) return announcedTrust;
  const root = window as Window & { trustwallet?: Eip1193 };
  if (root.trustwallet) return root.trustwallet;
  return browserProviders().find(provider => provider.isTrust || provider.isTrustWallet) ?? null;
}

function discoverTrustProvider(): Promise<Eip1193 | null> {
  const ready = trustProvider();
  if (ready) return Promise.resolve(ready);
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(trustProvider());
    }, 500);
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<{ info?: { rdns?: string }; provider?: Eip1193 }>).detail;
      if (detail?.info?.rdns !== 'com.trustwallet.app' || !detail.provider) return;
      rememberTrustProvider(detail.provider);
      window.clearTimeout(timer);
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(detail.provider);
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  });
}

async function trustXrpAddress(provider: Eip1193): Promise<string> {
  const root = window as Window & { trustwallet?: Eip1193 & { ripple?: { address?: string; request?: Eip1193['request'] }; xrp?: { address?: string; request?: Eip1193['request'] } } };
  const namespaces = [root.trustwallet?.ripple, root.trustwallet?.xrp];
  for (const namespace of namespaces) {
    if (!namespace) continue;
    if (namespace.address?.startsWith('r')) return namespace.address;
    if (!namespace.request) continue;
    try {
      const result = await namespace.request({ method: 'getAddress' });
      const value = typeof result === 'string' ? result : readText(result, ['address', 'account', 'publicAddress']);
      if (value.startsWith('r')) return value;
    } catch {
      // This Trust Wallet build does not expose that namespace.
    }
  }
  void provider;
  return '';
}

function metamaskProvider(): Eip1193 | null {
  const trust = trustProvider();
  return browserProviders().find(provider => provider.isMetaMask && provider !== trust && !provider.isTrust && !provider.isTrustWallet) ?? null;
}

async function snapRequest(provider: Eip1193, method: string, params?: unknown) {
  return provider.request({
    method: 'wallet_invokeSnap',
    params: { snapId: SNAP_ID, request: params === undefined ? { method } : { method, params } },
  });
}

async function connectMetaMask(): Promise<string> {
  const provider = metamaskProvider();
  if (!provider) throw new Error('MetaMask is not installed in this browser.');
  await provider.request({ method: 'eth_requestAccounts' });
  await provider.request({ method: 'wallet_requestSnaps', params: { [SNAP_ID]: {} } });
  const active = await snapRequest(provider, 'xrpl_getActiveNetwork') as { chainId?: number } | null;
  if (active?.chainId !== 0) await snapRequest(provider, 'xrpl_changeNetwork', { chainId: 0 });
  const account = await snapRequest(provider, 'xrpl_getAccount') as { account?: string } | null;
  if (!account?.account) throw new Error('MetaMask did not share an XRP address. Approve the XRP Ledger snap and try again.');
  return account.account;
}

async function connectTrust(): Promise<{ account: string; xrp: string }> {
  const provider = await discoverTrustProvider();
  if (!provider) throw new Error('Trust Wallet is not installed in this browser.');
  rememberTrustProvider(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const account = accounts.find(item => item.startsWith('0x')) ?? '';
  if (!account) throw new Error('Trust Wallet did not share an account.');
  return { account, xrp: await trustXrpAddress(provider) };
}

function trustSendUrl(destination: string, amount: string, destinationTag?: number) {
  const params = new URLSearchParams({ asset: XRP_ASSET, address: destination, amount });
  if (destinationTag != null) params.set('memo', String(destinationTag));
  return `https://link.trustwallet.com/send?${params.toString()}`;
}

async function sendWithMetaMask(from: string, destination: string, drops: string, destinationTag?: number) {
  const provider = metamaskProvider();
  if (!provider) throw new Error('MetaMask is not installed in this browser.');
  const active = await snapRequest(provider, 'xrpl_getActiveNetwork') as { chainId?: number } | null;
  if (active?.chainId !== 0) await snapRequest(provider, 'xrpl_changeNetwork', { chainId: 0 });
  const submitted = await snapRequest(provider, 'xrpl_signAndSubmit', {
    TransactionType: 'Payment',
    Account: from,
    Destination: destination,
    Amount: drops,
    ...(destinationTag == null ? {} : { DestinationTag: destinationTag }),
  });
  const hash = typeof submitted === 'string' ? submitted : readText(submitted, ['hash']);
  if (!hash) throw new Error('MetaMask did not return a transaction hash.');
  return hash;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The status line is enough.
  }
  return `The XRP Ledger request failed (${response.status}).`;
}

async function ledgerGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

async function ledgerPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

function readText(value: unknown, keys: string[], depth = 0): string {
  if (!value || typeof value !== 'object' || depth > 6) return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  for (const key of ['response', 'data', 'resp', 'result', 'session', 'tx_json']) {
    const found = readText(record[key], keys, depth + 1);
    if (found) return found;
  }
  return '';
}

type GemResult = { address?: string; publicAddress?: string; hash?: string; isInstalled?: boolean; network?: string | { name?: string }; chain?: string; result?: GemResult };

function gemError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '';
}

function unwrapGem(result?: GemResult): GemResult {
  return result?.result && typeof result.result === 'object' ? result.result : result ?? {};
}

function gemMessage(type: string, payload?: unknown): Promise<{ result?: GemResult }> {
  const messageId = Date.now() + Math.random();
  const installed = Boolean((window as Window & { gemWallet?: boolean }).gemWallet);
  if (!installed && type !== 'REQUEST_IS_INSTALLED/V3') return Promise.reject(new Error('GemWallet is not installed in this browser.'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      if (type === 'REQUEST_IS_INSTALLED/V3') resolve({ result: { isInstalled: false } });
      else reject(new Error('GemWallet did not respond.'));
    }, type === 'REQUEST_IS_INSTALLED/V3' ? 1_000 : 120_000);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { source?: string; messageId?: number; messagedId?: number; result?: GemResult; error?: unknown };
      if (data?.source !== 'GEM_WALLET_MSG_RESPONSE') return;
      if (data.messageId !== messageId && data.messagedId !== messageId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      const message = gemError(data.error);
      if (message) reject(new Error(message));
      else resolve({ result: data.result });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'GEM_WALLET_MSG_REQUEST', messageId, app: 'gem-wallet', type, payload }, window.location.origin);
  });
}

async function connectGemWallet(): Promise<string> {
  const installed = await gemMessage('REQUEST_IS_INSTALLED/V3');
  const payload = unwrapGem(installed.result);
  if (!payload.isInstalled && !installed.result?.isInstalled) throw new Error('GemWallet is not installed in this browser.');
  (window as Window & { gemWallet?: boolean }).gemWallet = true;
  const network = unwrapGem((await gemMessage('REQUEST_GET_NETWORK/V3')).result);
  const name = typeof network.network === 'string' ? network.network : network.network?.name;
  if ((network.chain && network.chain !== 'XRPL') || (name && name !== 'Mainnet')) throw new Error('Switch GemWallet to the XRP Ledger Mainnet.');
  const address = unwrapGem((await gemMessage('REQUEST_GET_ADDRESS/V3', { url: window.location.origin, title: document.title, favicon: null })).result);
  const value = address.address || address.publicAddress;
  if (!value) throw new Error('GemWallet did not share an address.');
  return value;
}

async function sendWithGemWallet(destination: string, amount: string, destinationTag?: number) {
  const payment = await gemMessage('REQUEST_SEND_PAYMENT/V3', { amount, destination, ...(destinationTag == null ? {} : { destinationTag }) });
  const hash = unwrapGem(payment.result).hash;
  if (!hash) throw new Error('GemWallet did not return a transaction hash.');
  return hash;
}

function crossmark(): CrossmarkApi | null {
  return (window as Window & { crossmark?: CrossmarkApi }).crossmark ?? null;
}

async function connectCrossmark(): Promise<string> {
  const wallet = crossmark();
  if (!wallet) throw new Error('Crossmark is not installed in this browser.');
  const signIn = wallet.signInAndWait ?? wallet.async?.signInAndWait ?? wallet.methods?.signInAndWait;
  const signed = signIn ? await signIn() : undefined;
  const address = wallet.session?.address || wallet.methods?.getAddress?.() || readText(signed, ['address', 'publicAddress', 'account']);
  if (!address) throw new Error('Crossmark did not share an address.');
  const network = wallet.session?.network ?? wallet.methods?.getNetwork?.();
  const blob = `${network?.label ?? ''} ${network?.wss ?? ''} ${network?.rpc ?? ''}`.toLowerCase();
  if (blob.includes('test') || blob.includes('devnet') || blob.includes('altnet')) throw new Error('Switch Crossmark to the XRP Ledger Mainnet.');
  return address;
}

async function sendWithCrossmark(from: string, destination: string, drops: string, destinationTag?: number) {
  const wallet = crossmark();
  const submit = wallet?.signAndSubmitAndWait ?? wallet?.async?.signAndSubmitAndWait ?? wallet?.methods?.signAndSubmitAndWait ?? wallet?.signAndSubmit;
  if (!submit) throw new Error('Crossmark cannot submit a payment from this page.');
  const tx: Record<string, unknown> = { TransactionType: 'Payment', Account: from, Destination: destination, Amount: drops };
  if (destinationTag != null) tx.DestinationTag = destinationTag;
  const hash = readText(await submit(tx), ['hash']);
  if (!hash) throw new Error('Crossmark did not return a transaction hash.');
  return hash;
}

function WalletMark({ label }: { label: string }) {
  return <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0B1220] text-sm font-bold text-white">{label.slice(0, 1)}</span>;
}

function ActionButton({ active, onClick, icon, label, testId }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; testId: string }) {
  return <button type="button" onClick={onClick} data-testid={testId} className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-xs font-semibold ${active ? 'border-primary bg-primary text-white' : 'border-border bg-card hover:bg-muted'}`}>
    <span className={`grid h-10 w-10 place-items-center rounded-full ${active ? 'bg-white/15' : 'bg-primary/10 text-primary'}`}>{icon}</span>
    {label}
  </button>;
}

export function XrpWalletPage() {
  const [address, setAddress] = useState('');
  const [xrpDraft, setXrpDraft] = useState('');
  const [trustAccount, setTrustAccount] = useState('');
  const [wallet, setWallet] = useState<WalletKind | null>(null);
  const [account, setAccount] = useState<LedgerAccount | null>(null);
  const [transfers, setTransfers] = useState<LedgerTransfer[]>([]);
  const [action, setAction] = useState<Action>('send');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [tag, setTag] = useState('');
  const [swapAmount, setSwapAmount] = useState('');
  const [receiveUsd, setReceiveUsd] = useState(true);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const [note, setNote] = useState('');
  const [trustPayment, setTrustPayment] = useState('');
  const [copied, setCopied] = useState(false);
  const installed = { metamask: Boolean(metamaskProvider()), trust: Boolean(trustProvider()) };

  async function load(nextAddress: string) {
    const [nextAccount, history] = await Promise.all([
      ledgerGet<LedgerAccount>(`/api/xrpl/account?address=${encodeURIComponent(nextAddress)}`),
      ledgerGet<{ transfers: LedgerTransfer[] }>(`/api/xrpl/transfers?address=${encodeURIComponent(nextAddress)}`),
    ]);
    setAccount(nextAccount);
    setTransfers(history.transfers);
    setAddress(nextAddress);
    sessionStorage.setItem(ADDRESS_KEY, nextAddress);
  }

  function remember(kind: WalletKind) {
    setWallet(kind);
    sessionStorage.setItem(WALLET_KEY, kind);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(ADDRESS_KEY) ?? '';
    const savedWallet = sessionStorage.getItem(WALLET_KEY);
    const savedTrust = sessionStorage.getItem(TRUST_ACCOUNT_KEY) ?? '';
    if (savedTrust) setTrustAccount(savedTrust);
    if (saved) setXrpDraft(saved);
    if (savedWallet === 'metamask' || savedWallet === 'trust' || savedWallet === 'gemwallet' || savedWallet === 'crossmark') setWallet(savedWallet);
    if (!saved) return;
    setBusy('load');
    void load(saved).catch(reason => setError(reason instanceof Error ? reason.message : 'The XRP account could not be loaded.')).finally(() => setBusy(''));
  }, []);

  useEffect(() => {
    let cancel = false;
    void fetch('/api/market/ticker?symbol=XRP/USDT')
      .then(response => response.ok ? response.json() as Promise<{ price?: number }> : null)
      .then(body => { if (!cancel && body && typeof body.price === 'number') setPrice(body.price); })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  async function connect(kind: WalletKind) {
    setBusy(kind);
    setError('');
    setHash('');
    setNote('');
    try {
      if (kind === 'trust') {
        const connected = await connectTrust();
        setTrustAccount(connected.account);
        sessionStorage.setItem(TRUST_ACCOUNT_KEY, connected.account);
        remember('trust');
        setAction('receive');
        if (connected.xrp) {
          setXrpDraft(connected.xrp);
          await load(connected.xrp);
          setNote('Trust Wallet manager is open. This is the XRP address from the extension.');
        } else {
          setNote('Trust Wallet manager is open. Add the XRP address shown in the extension to manage send and receive here.');
        }
        return;
      }
      const next = kind === 'metamask' ? await connectMetaMask() : kind === 'gemwallet' ? await connectGemWallet() : await connectCrossmark();
      remember(kind);
      setAction('receive');
      await load(next);
      setNote(`${walletLabel(kind)} shared this XRP address. Receive uses it. Send asks the extension to approve.`);
    } catch (reason) {
      setError(providerMessage(reason));
    } finally {
      setBusy('');
    }
  }

  function disconnect() {
    setWallet(null);
    setAddress('');
    setAccount(null);
    setTransfers([]);
    setTrustAccount('');
    setHash('');
    setNote('');
    setError('');
    sessionStorage.removeItem(ADDRESS_KEY);
    sessionStorage.removeItem(WALLET_KEY);
    sessionStorage.removeItem(TRUST_ACCOUNT_KEY);
    setTrustPayment('');
  }

  async function saveXrpAccount(event?: FormEvent) {
    event?.preventDefault();
    const next = xrpDraft.trim();
    if (!next) return;
    setBusy('xrp');
    setError('');
    try {
      await load(next);
      setNote('XRP account saved in the Trust Wallet manager.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The XRP account could not be loaded.');
    } finally {
      setBusy('');
    }
  }

  async function refresh() {
    if (!address) return;
    setBusy('refresh');
    setError('');
    try { await load(address); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The XRP account could not be loaded.'); } finally { setBusy(''); }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Select the address and copy it.');
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!address) {
      setError('Add the XRP address in the Trust Wallet manager before sending.');
      setAction('receive');
      return;
    }
    setBusy('send');
    setError('');
    setHash('');
    setTrustPayment('');
    const destinationTag = tag.trim() === '' ? undefined : Number(tag.trim());
    const trustWindow = wallet === 'trust' ? window.open('about:blank', '_blank') : null;
    try {
      const checked = await ledgerPost<{ drops: string; amountXrp: number; warnings: string[] }>('/api/xrpl/check-payment', {
        from: address,
        destination: destination.trim(),
        amount: amount.trim(),
        destinationTag,
      });
      if (wallet === 'trust') {
        const url = trustSendUrl(destination.trim(), amount.trim(), destinationTag);
        setTrustPayment(url);
        if (trustWindow && !trustWindow.closed) trustWindow.location.href = url;
        else trustWindow?.close();
        setNote(checked.warnings[0] ?? 'The ledger check passed. Approve the payment in Trust Wallet.');
        return;
      }
      const txHash = wallet === 'gemwallet'
        ? await sendWithGemWallet(destination.trim(), amount.trim(), destinationTag)
        : wallet === 'crossmark'
          ? await sendWithCrossmark(address, destination.trim(), checked.drops, destinationTag)
          : await sendWithMetaMask(address, destination.trim(), checked.drops, destinationTag);
      setHash(txHash);
      setAmount('');
      setTag('');
      setNote(checked.warnings[0] ?? 'The extension submitted the payment.');
      await load(address);
    } catch (reason) {
      trustWindow?.close();
      setTrustPayment('');
      setError(providerMessage(reason));
    } finally {
      setBusy('');
    }
  }

  function fillMax() {
    if (!account) return;
    const max = Math.max(0, Math.round((account.spendableXrp - 0.001) * 1_000_000) / 1_000_000);
    setAmount(max > 0 ? String(max) : '');
  }

  const swapQty = Number(swapAmount);
  const swapOut = price != null && Number.isFinite(swapQty) && swapQty > 0 ? receiveUsd ? swapQty * price : swapQty / price : null;
  const swapUrl = `https://link.trustwallet.com/swap?${new URLSearchParams(receiveUsd ? { from: XRP_ASSET, to: USDC_ASSET } : { from: USDC_ASSET, to: XRP_ASSET }).toString()}`;

  if (!wallet) {
    return <div className="mx-auto max-w-xl space-y-4">
      <div className="page-intro px-5 py-5">
        <div className="eyebrow mb-2">XRP Ledger · mainnet</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">Connect a wallet</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Choose the extension already in this browser. MetaMask opens its popup and shares the XRP address. Trust Wallet opens its popup and connects the extension.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={Boolean(busy)} onClick={() => void connect('metamask')} className="panel flex items-center gap-3 p-4 text-left hover:border-primary disabled:opacity-60" data-testid="button-connect-metamask">
          <WalletMark label="MetaMask" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">MetaMask</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{installed.metamask ? 'Installed · XRP Ledger' : 'Not detected in this browser'}</span></span>
          <span className="text-xs font-semibold text-primary">{busy === 'metamask' ? 'Waiting…' : 'Connect'}</span>
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void connect('trust')} className="panel flex items-center gap-3 p-4 text-left hover:border-primary disabled:opacity-60" data-testid="button-connect-trust">
          <WalletMark label="Trust Wallet" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Trust Wallet</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{installed.trust ? 'Installed · extension' : 'Not detected in this browser'}</span></span>
          <span className="text-xs font-semibold text-primary">{busy === 'trust' ? 'Waiting…' : 'Connect'}</span>
        </button>
      </div>
      {!installed.metamask && <a className="block text-xs font-semibold text-primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask</a>}
      {!installed.trust && <a className="block text-xs font-semibold text-primary" href="https://trustwallet.com/download" target="_blank" rel="noreferrer">Get Trust Wallet</a>}
      <div className="flex gap-4 text-[11px] font-semibold text-muted-foreground">
        <button type="button" onClick={() => void connect('gemwallet')} data-testid="button-connect-gemwallet">GemWallet</button>
        <button type="button" onClick={() => void connect('crossmark')} data-testid="button-connect-crossmark">Crossmark</button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>;
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="eyebrow mb-2">{wallet === 'trust' ? 'Trust Wallet · manager' : `${walletLabel(wallet)} · XRP Ledger mainnet`}</div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-.04em] md:text-[34px]">{wallet === 'trust' ? 'Trust Wallet' : 'Wallet'}</h1>
      </div>
      <button type="button" onClick={disconnect} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold" data-testid="button-disconnect-wallet"><LogOut size={14} />Disconnect</button>
    </div>

    <section className="relative overflow-hidden rounded-3xl bg-[#0B1220] px-6 py-7 text-white md:px-8">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_40%,rgba(34,197,94,0.28),transparent_62%)]" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-200">{wallet === 'trust' ? `Trust Wallet${trustAccount ? ` · ${short(trustAccount)}` : ''}` : walletLabel(wallet)}</p>
          <p className="mt-2 font-mono-data text-4xl font-semibold tracking-[-.04em]" data-testid="text-xrp-balance">{account ? xrp(account.balanceXrp) : '—'}</p>
          <p className="mt-1 text-sm text-white/70" data-testid="text-xrp-usd">{account && price != null ? `${usd(account.balanceXrp * price)} · live ${price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 5 })} USD` : 'XRP'}</p>
          <p className="mt-2 text-xs text-white/60">{account ? `${xrp(account.spendableXrp)} spendable · ${xrp(account.reserveXrp)} reserved` : 'The balance appears when an XRP address is connected.'}</p>
          {address && <p className="mt-3 break-all font-mono-data text-[11px] text-white/50" data-testid="text-receive-address">{address}</p>}
        </div>
        {address && <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/20 px-3 text-xs font-semibold" data-testid="button-refresh-xrp"><RefreshCw size={14} />Refresh</button>}
      </div>
    </section>

    {wallet === 'trust' && <section className="panel overflow-hidden" data-testid="panel-trust-manager">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Manage</h2>
          <p className="mt-1 text-xs text-muted-foreground">Connected Trust Wallet account {trustAccount ? short(trustAccount) : ''}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">Extension</span>
      </div>
      <button type="button" onClick={() => setAction('receive')} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted" data-testid="button-manage-xrp">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#0B1220] text-xs font-bold text-white">X</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">XRP</span><span className="mt-0.5 block truncate font-mono-data text-[11px] text-muted-foreground">{address || 'Add the address from Trust Wallet'}</span></span>
        <span className="text-right"><span className="block font-mono-data text-sm font-semibold">{account ? xrp(account.balanceXrp) : '—'}</span><span className="text-[11px] font-semibold text-primary">Manage</span></span>
      </button>
    </section>}

    <div className="grid grid-cols-3 gap-3">
      <ActionButton active={action === 'send'} onClick={() => setAction('send')} icon={<ArrowUpRight size={18} />} label="Send" testId="button-action-send" />
      <ActionButton active={action === 'receive'} onClick={() => setAction('receive')} icon={<ArrowDownLeft size={18} />} label="Receive" testId="button-action-receive" />
      <ActionButton active={action === 'swap'} onClick={() => setAction('swap')} icon={<ArrowLeftRight size={18} />} label="Swap" testId="button-action-swap" />
    </div>

    {action === 'send' && <section className="panel p-4 md:p-5">
      <h2 className="text-sm font-semibold">Send</h2>
      <p className="mt-1 text-xs text-muted-foreground">{wallet === 'trust' ? 'The desk checks the ledger first. Trust Wallet opens the payment only after that check passes.' : wallet === 'metamask' ? 'The desk checks the ledger, then MetaMask asks you to approve the XRP payment.' : `The desk checks the ledger, then ${walletLabel(wallet)} asks you to approve the payment.`}</p>
      <form className="mt-4 space-y-3" onSubmit={event => void send(event)}>
        <label className="block space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">To</span><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="r..." className={fieldClass} autoComplete="off" spellCheck={false} data-testid="input-xrp-destination" /></label>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <label className="block space-y-1.5"><span className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">Amount <button type="button" onClick={fillMax} className="font-semibold text-primary" data-testid="button-max-xrp">Max</button></span><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" className={fieldClass} data-testid="input-xrp-amount" /></label>
          <label className="block space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">Destination tag</span><input value={tag} onChange={event => setTag(event.target.value)} inputMode="numeric" placeholder="Optional" className={fieldClass} data-testid="input-xrp-tag" /></label>
        </div>
        <button type="submit" disabled={Boolean(busy) || !address || !destination.trim() || !amount.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" data-testid="button-send-xrp"><ArrowUpRight size={16} />{busy === 'send' ? 'Waiting for the wallet…' : `Send with ${walletLabel(wallet)}`}</button>
      </form>
    </section>}

    {action === 'receive' && <section className="panel p-4 md:p-5">
      <h2 className="text-sm font-semibold">Receive</h2>
      <p className="mt-1 text-xs text-muted-foreground">Share this address. Only XRP on the XRP Ledger mainnet should be sent here.</p>
      {address ? <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
        <p className="text-[11px] font-medium text-muted-foreground">Your address</p>
        <p className="mt-2 break-all font-mono-data text-sm">{address}</p>
        <button type="button" onClick={() => void copyAddress()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold" data-testid="button-copy-address"><Copy size={14} />{copied ? 'Copied' : 'Copy address'}</button>
      </div> : wallet === 'trust' ? <form className="mt-4 space-y-3" onSubmit={event => void saveXrpAccount(event)}>
        <p className="text-sm text-muted-foreground">In the Trust Wallet extension, open XRP and copy the address that starts with r. Save it here to manage that account.</p>
        <input value={xrpDraft} onChange={event => setXrpDraft(event.target.value)} placeholder="r..." className={fieldClass} autoComplete="off" spellCheck={false} data-testid="input-xrp-watch" />
        <button type="submit" disabled={Boolean(busy) || !xrpDraft.trim()} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" data-testid="button-watch-xrp">{busy === 'xrp' ? 'Saving…' : 'Save XRP account'}</button>
      </form> : <p className="mt-4 text-sm text-muted-foreground">This wallet has not shared an XRP address yet.</p>}
      {account && !account.funded && <p className="mt-3 text-xs text-muted-foreground">This address is not funded yet. The first payment has to cover the {xrp(account.reserveXrp)} XRP reserve.</p>}
    </section>}

    {action === 'swap' && <section className="panel p-4 md:p-5">
      <h2 className="text-sm font-semibold">Swap</h2>
      <p className="mt-1 text-xs text-muted-foreground">USDC is the dollar token. The amount below uses the live XRP price. Trust Wallet performs the exchange.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setReceiveUsd(true)} className={`min-h-11 rounded-xl border text-sm font-semibold ${receiveUsd ? 'border-primary bg-primary text-white' : 'border-border bg-card'}`} data-testid="button-swap-get-usdc">Get USDC</button>
        <button type="button" onClick={() => setReceiveUsd(false)} className={`min-h-11 rounded-xl border text-sm font-semibold ${receiveUsd ? 'border-border bg-card' : 'border-primary bg-primary text-white'}`} data-testid="button-swap-get-xrp">Get XRP</button>
      </div>
      <label className="mt-3 block space-y-1.5"><span className="text-[11px] font-medium text-muted-foreground">{receiveUsd ? 'XRP you swap' : 'USDC you swap'}</span><input value={swapAmount} onChange={event => setSwapAmount(event.target.value)} inputMode="decimal" placeholder="0.00" className={fieldClass} data-testid="input-swap-amount" /></label>
      <p className="mt-3 text-sm" data-testid="text-swap-receive">{swapOut == null ? 'Enter an amount to see what you get.' : `You get about ${xrp(swapOut)} ${receiveUsd ? 'USDC' : 'XRP'}${price == null ? '' : ` · XRP ${xrp(price)}`}`}</p>
      <a className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white" href={swapUrl} target="_blank" rel="noreferrer" data-testid="button-swap-xrp"><ArrowLeftRight size={16} />Open swap in Trust Wallet</a>
    </section>}

    {(note || error || hash) && <div className="panel px-4 py-3 text-xs">
      {note && <p data-testid="text-trust-note">{note}</p>}
      {trustPayment && <a className="mt-2 inline-block font-semibold text-primary" href={trustPayment} target="_blank" rel="noreferrer" data-testid="link-trust-payment">Open the payment in Trust Wallet</a>}
      {hash && <p className="mt-1">Submitted. <a className="font-semibold text-primary" href={`https://livenet.xrpl.org/transactions/${hash}`} target="_blank" rel="noreferrer">{short(hash)}</a></p>}
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>}

    <section className="panel overflow-hidden">
      <div className="border-b border-border px-4 py-3.5">
        <h2 className="text-sm font-semibold">Activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">Validated XRP payments for this address.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] uppercase tracking-[.06em] text-muted-foreground">
            <tr className="border-b border-border">{['Direction', 'Amount', 'Counterparty', 'Tag', 'Result'].map(label => <th key={label} className="px-4 py-2 font-semibold">{label}</th>)}</tr>
          </thead>
          <tbody>
            {transfers.length ? transfers.map(row => <tr key={row.hash} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 font-semibold capitalize">{row.direction}</td>
              <td className="px-4 py-3 font-mono-data">{row.amountXrp == null ? 'Issued' : `${xrp(row.amountXrp)} XRP`}</td>
              <td className="px-4 py-3 font-mono-data">{short(row.counterparty)}</td>
              <td className="px-4 py-3 font-mono-data">{row.destinationTag ?? '—'}</td>
              <td className="px-4 py-3"><a className="font-semibold text-primary" href={`https://livenet.xrpl.org/transactions/${row.hash}`} target="_blank" rel="noreferrer">{row.result || 'View'}</a></td>
            </tr>) : <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{address ? 'No XRP payments yet.' : 'Connect an XRP address to see activity.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
