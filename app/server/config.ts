import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.join(APP_ROOT, ".env.local"), override: true });
dotenv.config();

export type ProviderMode = "mock" | "laozhang";

export const APP_QUEUE_CONCURRENCY = 3;

export interface AppConfig {
  port: number;
  productRoot: string;
  providerMode: ProviderMode;
  defaultConcurrency: number;
  laozhangApiKey: string | null;
  laozhangEndpoint: string;
  mockLatencyMinMs: number;
  mockLatencyMaxMs: number;
}

const DEFAULT_PRODUCT_ROOT = path.resolve(APP_ROOT, "../data/nsm100k");
const LAOZHANG_ENDPOINT =
  "https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function providerModeFromEnv(value: string | undefined): ProviderMode {
  if (!value || value === "mock") return "mock";
  if (value === "laozhang") return "laozhang";
  throw new Error(`Unsupported PROVIDER_MODE "${value}". Use "mock" or "laozhang".`);
}

function clampConcurrency(value: number): number {
  return Math.max(1, Math.min(3, value));
}

function resolveProductRoot(value: string | undefined): string {
  if (!value) return DEFAULT_PRODUCT_ROOT;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(APP_ROOT, value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const providerMode = providerModeFromEnv(env.PROVIDER_MODE);
  const laozhangApiKey = env.LAOZHANG_API_KEY?.trim() || null;

  if (providerMode === "laozhang" && !laozhangApiKey) {
    throw new Error("LAOZHANG_API_KEY is required when PROVIDER_MODE=laozhang.");
  }

  return {
    port: numberFromEnv(env.APP_PORT ?? env.PORT, 8787),
    productRoot: resolveProductRoot(env.PRODUCT_ROOT ?? env.APP_PRODUCT_ROOT),
    providerMode,
    defaultConcurrency: APP_QUEUE_CONCURRENCY,
    laozhangApiKey,
    laozhangEndpoint: env.LAOZHANG_ENDPOINT ?? LAOZHANG_ENDPOINT,
    mockLatencyMinMs: numberFromEnv(env.MOCK_LATENCY_MIN_MS, 500),
    mockLatencyMaxMs: numberFromEnv(env.MOCK_LATENCY_MAX_MS, 1500)
  };
}

export const config = loadConfig();

export function clampQueueConcurrency(value: unknown, fallback = APP_QUEUE_CONCURRENCY): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clampConcurrency(fallback);
  }
  return clampConcurrency(Math.trunc(value));
}
