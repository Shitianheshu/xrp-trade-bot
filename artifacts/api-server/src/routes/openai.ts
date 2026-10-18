import { Router, type IRouter } from "express";
import { openAiKeys } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import {
  isOpenAiKey,
  OpenAiError,
  openAiHint,
  resolveOpenAiKey,
  verifyOpenAiKey,
  writeAiBriefing,
} from "../lib/openai";

const router: IRouter = Router();
router.use(requireAuth);

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  const message = error instanceof OpenAiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "OpenAI request failed.";
  res.status(400).json({ error: message });
}

router.get("/openai", async (_req, res): Promise<void> => {
  const resolved = await resolveOpenAiKey(authenticatedUserId(res));
  if (!resolved) {
    res.json({ configured: false, source: "none", hint: "" });
    return;
  }
  res.json({ configured: true, source: resolved.source, hint: openAiHint(resolved.apiKey) });
});

router.put("/openai", async (req, res): Promise<void> => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!isOpenAiKey(apiKey)) {
    res.status(400).json({ error: "Paste an OpenAI API key. It starts with sk-." });
    return;
  }
  try {
    await verifyOpenAiKey(apiKey);
    await openAiKeys.save({ userId: authenticatedUserId(res), apiKey, updatedAt: new Date() });
    res.json({ configured: true, source: "saved", hint: openAiHint(apiKey) });
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/openai", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  await openAiKeys.remove(userId);
  const resolved = await resolveOpenAiKey(userId);
  res.json(resolved
    ? { configured: true, source: resolved.source, hint: openAiHint(resolved.apiKey) }
    : { configured: false, source: "none", hint: "" });
});

router.post("/openai/briefing", async (req, res): Promise<void> => {
  const resolved = await resolveOpenAiKey(authenticatedUserId(res));
  if (!resolved) {
    res.status(409).json({ error: "Add an OpenAI API key before requesting an AI analysis." });
    return;
  }
  const deskVerdict = req.body?.deskVerdict === "ready" || req.body?.deskVerdict === "wait" || req.body?.deskVerdict === "blocked"
    ? req.body.deskVerdict
    : "";
  if (!deskVerdict || typeof req.body?.symbol !== "string") {
    res.status(400).json({ error: "The desk snapshot is incomplete." });
    return;
  }
  const facts = {
    symbol: String(req.body.symbol).slice(0, 24),
    deskVerdict,
    deskHeadline: typeof req.body.deskHeadline === "string" ? req.body.deskHeadline.slice(0, 180) : "",
    deskSummary: typeof req.body.deskSummary === "string" ? req.body.deskSummary.slice(0, 600) : "",
    stats: req.body.stats ?? {},
    factors: Array.isArray(req.body.factors) ? req.body.factors.slice(0, 12) : [],
  };
  try {
    const briefing = await writeAiBriefing(resolved.apiKey, facts, deskVerdict);
    res.json(briefing);
  } catch (error) {
    fail(res, error);
  }
});

export default router;
