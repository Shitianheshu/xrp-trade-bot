import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import strategiesRouter from "./strategies";
import tradingRouter from "./trading";
import backtestsRouter from "./backtests";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(strategiesRouter);
router.use(tradingRouter);
router.use(backtestsRouter);

export default router;
