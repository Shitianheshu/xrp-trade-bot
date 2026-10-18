import type { Server } from "node:http";
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from "ws";
import { logger } from "./logger";
import { handleTankUpgrade } from "./tank-arena";

const streamServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const MAX_CLIENTS = 100;
const MAX_PER_IP = 10;
const perIp = new Map<string, number>();
const pairPattern = /^([A-Z0-9]{2,14})\/(USDT|USDC|USD|BTC|ETH|JPY)$/;

function parseTicker(raw: RawData, symbol: string) {
  const event = JSON.parse(raw.toString()) as Record<string, unknown>;
  const price = Number(event.c);
  const change24h = Number(event.p);
  const changePct24h = Number(event.P);
  const high24h = Number(event.h);
  const low24h = Number(event.l);
  const volume24h = Number(event.v);
  const eventTime = Number(event.E);
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(change24h) ||
    !Number.isFinite(changePct24h) ||
    !Number.isFinite(high24h) ||
    !Number.isFinite(low24h) ||
    !Number.isFinite(volume24h) ||
    !Number.isFinite(eventTime)
  ) return null;
  return {
    exchange: "binance",
    symbol,
    price,
    change24h,
    changePct24h,
    high24h,
    low24h,
    volume24h,
    updatedAt: new Date(eventTime).toISOString(),
    stale: Date.now() - eventTime > 60_000,
  };
}

export function installRealtime(server: Server): void {
  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname === "/api/game/tank/live") {
      handleTankUpgrade(request, socket, head, url);
      return;
    }
    if (url.pathname !== "/api/stream") {
      socket.destroy();
      return;
    }
    const ip = request.socket.remoteAddress ?? "unknown";
    if (
      streamServer.clients.size >= MAX_CLIENTS ||
      (perIp.get(ip) ?? 0) >= MAX_PER_IP
    ) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    streamServer.handleUpgrade(request, socket, head, (client) => {
      streamServer.emit("connection", client, request);
    });
  });

  streamServer.on("connection", (client, request) => {
    const ip = request.socket.remoteAddress ?? "unknown";
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const symbol = (url.searchParams.get("symbol") ?? "XRP/USDT").toUpperCase();
    const match = pairPattern.exec(symbol);
    if (!match || (process.env.EXCHANGE ?? "binance").toLowerCase() !== "binance") {
      client.close(1008, "Unsupported market-data pair or exchange");
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    let upstream: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;
    let released = false;
    const releaseClientSlot = () => {
      if (released) return;
      released = true;
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
    };

    const connect = () => {
      if (disposed || client.readyState !== WebSocket.OPEN) return;
      const exchangeSymbol = `${match[1]}${match[2]}`.toLowerCase();
      upstream = new WebSocket(
        `wss://stream.binance.com:9443/ws/${exchangeSymbol}@ticker`,
        { handshakeTimeout: 7000, maxPayload: 16_384 },
      );
      upstream.on("open", () => { attempts = 0; });
      upstream.on("message", (raw) => {
        try {
          const data = parseTicker(raw, symbol);
          if (data && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        } catch (error) {
          logger.warn({ err: error, symbol }, "Invalid Binance stream message");
        }
      });
      upstream.on("error", () => {
        upstream?.terminate();
      });
      upstream.on("close", () => {
        if (disposed || client.readyState !== WebSocket.OPEN) return;
        attempts += 1;
        if (attempts > 8) {
          client.close(1011, "Exchange stream unavailable");
          return;
        }
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (attempts - 1), 30_000));
      });
    };

    const pump = setInterval(() => {
      if (disposed || client.readyState !== WebSocket.OPEN) return;
      if (!upstream && !retryTimer) connect();
    }, 1_000);

    client.on("close", () => {
      disposed = true;
      clearInterval(pump);
      if (retryTimer) clearTimeout(retryTimer);
      upstream?.close();
      releaseClientSlot();
    });
    client.on("error", () => {
      disposed = true;
      clearInterval(pump);
      if (retryTimer) clearTimeout(retryTimer);
      upstream?.terminate();
      releaseClientSlot();
    });
    connect();
  });
}