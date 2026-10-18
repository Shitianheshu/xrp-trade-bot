import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { XrplPublicError, checkPayment, isClassicAddress, readAccount, readTransfers } from "../lib/xrpl-public";

const router: IRouter = Router();
router.use(requireAuth);

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  const status = error instanceof XrplPublicError ? error.status : 502;
  const message = error instanceof Error ? error.message : "The XRP Ledger request failed.";
  res.status(status).json({ error: message });
}

router.get("/xrpl/account", async (req, res): Promise<void> => {
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  if (!isClassicAddress(address)) {
    res.status(400).json({ error: "Enter a classic XRP address that starts with r." });
    return;
  }
  try {
    res.json(await readAccount(address));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/xrpl/transfers", async (req, res): Promise<void> => {
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  if (!isClassicAddress(address)) {
    res.status(400).json({ error: "Enter a classic XRP address that starts with r." });
    return;
  }
  try {
    res.json({ transfers: await readTransfers(address) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/xrpl/check-payment", async (req, res): Promise<void> => {
  const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";
  const destination = typeof req.body?.destination === "string" ? req.body.destination.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : String(req.body?.amount ?? "");
  const tagRaw = req.body?.destinationTag;
  const destinationTag = tagRaw === "" || tagRaw == null ? undefined : Number(tagRaw);
  try {
    res.json(await checkPayment(from, destination, amount, destinationTag));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
