import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPort(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function launch(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true,
  });
  children.push(child);
  return child;
}

async function ensureMongo() {
  if (await canConnect(27017)) {
    console.log("MongoDB is already listening on 127.0.0.1:27017");
    return;
  }
  const dataDir = path.join(root, ".mongo-data");
  mkdirSync(dataDir, { recursive: true });
  console.log("Starting local MongoDB");
  launch("mongod", ["--dbpath", dataDir, "--bind_ip", "127.0.0.1", "--port", "27017"]);
  const ready = await waitForPort(27017);
  if (!ready) {
    throw new Error("MongoDB did not start on port 27017.");
  }
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

await ensureMongo();

const apiPort = process.env.API_PORT ?? "5050";

launch("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], {
  PORT: apiPort,
  NODE_ENV: "development",
  TRADING_MODE: "paper",
  MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/xrp-trading",
});

launch("pnpm", ["--filter", "@workspace/xrp-trading", "run", "dev"], {
  PORT: "5173",
  BASE_PATH: "/",
  API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
});
