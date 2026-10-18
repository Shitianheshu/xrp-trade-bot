import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import strategiesRouter from "./strategies";
import tradingRouter from "./trading";
import backtestsRouter from "./backtests";
import telegramRouter from "./telegram";
import openaiRouter from "./openai";
import analysisRouter from "./analysis";
import demoRouter from "./demo";
import xrplRouter from "./xrpl";
import stampRouter from "./stamp";
import coinRouter from "./coin";
import tankRouter from "./tank";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(strategiesRouter);
router.use(tradingRouter);
router.use(backtestsRouter);
router.use(telegramRouter);
router.use(openaiRouter);
router.use(analysisRouter);
router.use(demoRouter);
router.use(xrplRouter);
router.use(stampRouter);
router.use(coinRouter);
router.use(tankRouter);

export default router;
