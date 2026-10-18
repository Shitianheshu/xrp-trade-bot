import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export const LOCAL_DEMO_USER = "local-demo";
const localProfilePattern = /^local-[a-z0-9-]{3,40}$/;

export function clerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
}

export function localDemoUser(req: Request): string {
  const header = req.get("x-demo-user")?.trim().toLowerCase() ?? "";
  return localProfilePattern.test(header) ? header : LOCAL_DEMO_USER;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!clerkConfigured()) {
    res.locals.userId = localDemoUser(req);
    next();
    return;
  }
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.userId = userId;
  next();
}

export function authenticatedUserId(res: Response): string {
  const userId = res.locals.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Authenticated user ID was not attached to request");
  }
  return userId;
}