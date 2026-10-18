import { openAiKeys } from "@workspace/db";

export class OpenAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiError";
  }
}

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/;

export function isOpenAiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export async function resolveOpenAiKey(userId: string): Promise<{ apiKey: string; source: "saved" | "environment" } | null> {
  const saved = await openAiKeys.find(userId);
  if (saved && isOpenAiKey(saved.apiKey)) return { apiKey: saved.apiKey, source: "saved" };
  const fromEnv = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (isOpenAiKey(fromEnv)) return { apiKey: fromEnv, source: "environment" };
  return null;
}

export function openAiHint(apiKey: string): string {
  return `····${apiKey.slice(-4)}`;
}

export async function verifyOpenAiKey(apiKey: string): Promise<void> {
  const response = await openAiFetch(apiKey, "/v1/models");
  if (response.ok) return;
  throw new OpenAiError(await openAiErrorMessage(response));
}

export type AiBriefing = {
  headline: string;
  summary: string;
  points: string[];
  model: string;
};

export async function writeAiBriefing(apiKey: string, facts: unknown, deskVerdict: string): Promise<AiBriefing> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const response = await openAiFetch(apiKey, "/v1/chat/completions", {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You write a short paper-trading note for an XRP desk. Use only the facts in the user JSON. Do not invent prices, news, or indicators. Never instruct a live exchange order. If deskVerdict is blocked, do not say it is okay to start. If deskVerdict is wait, do not say it is okay to start. If deskVerdict is ready, you may say paper trading can start. Reply with JSON only: {\"headline\":\"\",\"summary\":\"\",\"points\":[\"\",\"\",\"\"]}.",
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
  });
  if (!response.ok) throw new OpenAiError(await openAiErrorMessage(response));
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed: { headline?: unknown; summary?: unknown; points?: unknown };
  try {
    parsed = JSON.parse(content) as { headline?: unknown; summary?: unknown; points?: unknown };
  } catch {
    throw new OpenAiError("OpenAI returned a note this desk could not read.");
  }
  const headline = typeof parsed.headline === "string" ? parsed.headline.trim().slice(0, 180) : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1200) : "";
  const points = Array.isArray(parsed.points)
    ? parsed.points.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4).map(item => item.trim().slice(0, 280))
    : [];
  if (!headline || !summary) throw new OpenAiError("OpenAI returned an empty note.");
  const blockedStart = deskVerdict !== "ready" && /okay to start|ok to start|you can start/i.test(`${headline} ${summary}`);
  return {
    headline: blockedStart ? "Do not start yet" : headline,
    summary: blockedStart ? `${summary} The desk checks still block a start.` : summary,
    points,
    model,
  };
}

async function openAiFetch(apiKey: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`https://api.openai.com${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new OpenAiError("OpenAI could not be reached. Check the network and try again.");
  }
}

async function openAiErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    const message = body.error?.message ?? "";
    if (response.status === 401) return "OpenAI rejected that API key.";
    if (response.status === 429) return "OpenAI rate limit reached. Wait a moment and refresh the analysis.";
    if (message) return message.slice(0, 240);
  } catch {
    // Use the status below.
  }
  return `OpenAI request failed (${response.status}).`;
}
