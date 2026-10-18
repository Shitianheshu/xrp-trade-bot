import { createHash } from "node:crypto";

const ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
const ENDPOINTS = ["https://xrplcluster.com/", "https://s1.ripple.com:51234/"];
const REQUIRE_DEST_TAG = 0x00020000;
const DISALLOW_XRP = 0x00080000;
const FEE_BUFFER_XRP = 0.001;

export class XrplPublicError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function decodeBase58(value: string): Uint8Array {
  const zeroCount = [...value].findIndex(char => char !== ALPHABET[0]);
  const zeros = zeroCount === -1 ? value.length : zeroCount;
  let num = 0n;
  for (const char of value.slice(zeros)) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("invalid");
    num = num * 58n + BigInt(digit);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const payload = hex === "0" ? new Uint8Array() : new Uint8Array(hex.length / 2);
  for (let i = 0; i < payload.length; i += 1) payload[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const out = new Uint8Array(zeros + payload.length);
  out.set(payload, zeros);
  return out;
}

export function isClassicAddress(value: string): boolean {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value)) return false;
  try {
    const bytes = decodeBase58(value);
    if (bytes.length < 25 || bytes[0] !== 0x00) return false;
    const payload = bytes.subarray(0, -4);
    const check = bytes.subarray(-4);
    const hash = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
    return check.every((byte, index) => byte === hash[index]);
  } catch {
    return false;
  }
}

export function xrpToDrops(amount: string): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new XrplPublicError("Enter an XRP amount with at most 6 decimal places.", 400);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const drops = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  if (drops <= 0n) throw new XrplPublicError("Amount must be greater than zero.", 400);
  return drops.toString();
}

export function dropsToXrp(drops: string): number {
  const value = BigInt(drops);
  return Number(value / 1_000_000n) + Number(value % 1_000_000n) / 1_000_000;
}

type LedgerResult = Record<string, unknown> & { error?: string; error_message?: string };

async function ledger(method: string, params: Record<string, unknown>): Promise<LedgerResult> {
  let last = "The XRP Ledger did not respond.";
  for (const url of ENDPOINTS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        last = `The XRP Ledger returned ${response.status}.`;
        continue;
      }
      const body = await response.json() as { result?: LedgerResult };
      const result = body.result;
      if (!result) {
        last = "The XRP Ledger returned an empty result.";
        continue;
      }
      if (result.error && result.error !== "actNotFound") {
        last = result.error_message || result.error;
        continue;
      }
      return result;
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new XrplPublicError(last);
}

function accountData(result: LedgerResult): Record<string, unknown> | null {
  const data = result.account_data;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function reserveFrom(server: LedgerResult, ownerCount: number): number {
  const validated = (server.info as { validated_ledger?: { reserve_base_xrp?: number; reserve_inc_xrp?: number } } | undefined)?.validated_ledger;
  const base = validated?.reserve_base_xrp ?? 1;
  const increment = validated?.reserve_inc_xrp ?? 0.2;
  return base + ownerCount * increment;
}

export async function readAccount(address: string) {
  if (!isClassicAddress(address)) throw new XrplPublicError("Enter a classic XRP address that starts with r.", 400);
  const [info, server] = await Promise.all([
    ledger("account_info", { account: address, ledger_index: "validated" }),
    ledger("server_info", {}),
  ]);
  if (info.error === "actNotFound") {
    return {
      address,
      funded: false,
      balanceXrp: 0,
      spendableXrp: 0,
      reserveXrp: reserveFrom(server, 0),
      sequence: null as number | null,
      requireDestinationTag: false,
      disallowXrp: false,
    };
  }
  const data = accountData(info);
  const balance = typeof data?.Balance === "string" ? data.Balance : "0";
  const ownerCount = typeof data?.OwnerCount === "number" ? data.OwnerCount : 0;
  const flags = typeof data?.Flags === "number" ? data.Flags : 0;
  const sequence = typeof data?.Sequence === "number" ? data.Sequence : null;
  const reserveXrp = reserveFrom(server, ownerCount);
  const balanceXrp = dropsToXrp(balance);
  return {
    address,
    funded: true,
    balanceXrp,
    spendableXrp: Math.max(0, Math.round((balanceXrp - reserveXrp) * 1_000_000) / 1_000_000),
    reserveXrp,
    sequence,
    requireDestinationTag: (flags & REQUIRE_DEST_TAG) !== 0,
    disallowXrp: (flags & DISALLOW_XRP) !== 0,
  };
}

export type LedgerTransfer = {
  hash: string;
  direction: "sent" | "received" | "other";
  counterparty: string;
  amountXrp: number | null;
  destinationTag: number | null;
  ledgerIndex: number | null;
  result: string;
};

function txBody(row: Record<string, unknown>): Record<string, unknown> {
  const tx = row.tx_json ?? row.tx;
  return tx && typeof tx === "object" ? tx as Record<string, unknown> : {};
}

export async function readTransfers(address: string): Promise<LedgerTransfer[]> {
  if (!isClassicAddress(address)) throw new XrplPublicError("Enter a classic XRP address that starts with r.", 400);
  const result = await ledger("account_tx", {
    account: address,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: 20,
  });
  const rows = Array.isArray(result.transactions) ? result.transactions : [];
  return rows.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const tx = txBody(row);
    if (tx.TransactionType !== "Payment") return [];
    const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
    const delivered = typeof meta.delivered_amount === "string" ? meta.delivered_amount : typeof tx.Amount === "string" ? tx.Amount : null;
    const account = typeof tx.Account === "string" ? tx.Account : "";
    const destination = typeof tx.Destination === "string" ? tx.Destination : "";
    const hash = typeof row.hash === "string" ? row.hash : typeof tx.hash === "string" ? tx.hash : "";
    if (!hash) return [];
    return [{
      hash,
      direction: account === address ? "sent" as const : destination === address ? "received" as const : "other" as const,
      counterparty: account === address ? destination : account,
      amountXrp: delivered ? dropsToXrp(delivered) : null,
      destinationTag: typeof tx.DestinationTag === "number" ? tx.DestinationTag : null,
      ledgerIndex: typeof row.ledger_index === "number" ? row.ledger_index : typeof tx.ledger_index === "number" ? tx.ledger_index : null,
      result: typeof meta.TransactionResult === "string" ? meta.TransactionResult : "",
    }];
  });
}

export async function checkPayment(from: string, destination: string, amount: string, destinationTag?: number) {
  if (!isClassicAddress(from) || !isClassicAddress(destination)) {
    throw new XrplPublicError("Both addresses must be classic XRP addresses.", 400);
  }
  if (from === destination) throw new XrplPublicError("Choose a different destination.", 400);
  if (destinationTag != null && (!Number.isInteger(destinationTag) || destinationTag < 0 || destinationTag > 4_294_967_295)) {
    throw new XrplPublicError("Destination tag must be a whole number up to 4294967295.", 400);
  }
  const drops = xrpToDrops(amount);
  const [source, dest] = await Promise.all([readAccount(from), readAccount(destination)]);
  if (!source.funded) throw new XrplPublicError("This XRP address is not funded yet, so it cannot send.", 409);
  const warnings: string[] = [];
  if (dest.disallowXrp) throw new XrplPublicError("That destination does not accept XRP payments.", 400);
  if (dest.requireDestinationTag && destinationTag == null) {
    throw new XrplPublicError("That destination requires a destination tag.", 400);
  }
  const amountXrp = dropsToXrp(drops);
  if (!dest.funded && amountXrp < dest.reserveXrp) {
    throw new XrplPublicError(`The destination is not on the ledger yet. The first payment must be at least ${dest.reserveXrp} XRP.`, 400);
  }
  if (!dest.funded) warnings.push("The destination is not on the ledger yet. This payment will create it.");
  if (amountXrp + FEE_BUFFER_XRP > source.spendableXrp) {
    throw new XrplPublicError(`Spendable XRP is ${source.spendableXrp}. Leave at least ${FEE_BUFFER_XRP} XRP for the network fee. The account reserve stays on the ledger.`, 409);
  }
  return { drops, amountXrp, spendableXrp: source.spendableXrp, reserveXrp: source.reserveXrp, warnings };
}
