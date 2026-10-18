import app from "./app";
import { logger } from "./lib/logger";
import { loadDemoSession } from "./lib/demo-market";
import { startPaperEngine } from "./lib/paper-engine";
import { startTelegramBot } from "./lib/telegram-bot";
import { startTelegramDigest } from "./lib/telegram-digest";
import { installRealtime } from "./lib/market-stream";
import { recoverTankRooms } from "./lib/tank-arena";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

void loadDemoSession();
startPaperEngine();
startTelegramDigest();
startTelegramBot();
const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
installRealtime(server);
recoverTankRooms().catch(error => logger.error({ err: error }, "Could not close unfinished tank rooms"));
