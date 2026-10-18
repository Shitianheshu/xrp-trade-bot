import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { apiRateLimit } from "./middlewares/rate-limit";
import { clerkConfigured } from "./middlewares/require-auth";
import router from "./routes";
import { logger } from "./lib/logger";

if ((process.env.TRADING_MODE ?? "paper").toLowerCase() !== "paper") {
  throw new Error("This application only supports paper trading.");
}

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Keep the Clerk proxy before parsers so OAuth requests retain their raw body.
if (clerkConfigured()) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

if (clerkConfigured()) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
} else {
  logger.warn("Clerk keys are not set. API requests use the local demo account.");
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use("/api", apiRateLimit);
app.use("/api", router);

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: error, path: req.path }, "Unhandled API request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Request failed. No simulated order was submitted." });
});

export default app;
