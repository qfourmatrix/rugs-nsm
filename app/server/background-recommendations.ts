import { promises as fs } from "node:fs";
import path from "node:path";
import { BACKGROUND_REQUIRED_SHOT_IDS } from "../shared/constants";
import { isBackgroundCompatibleForShot } from "../shared/background-compatibility";
import { BACKGROUND_RECOMMENDATIONS_FILENAME, BackgroundRecommendationsPackSchema, type BackgroundRecommendationsPack, type BackgroundRecommendationsResponse } from "../shared/background-recommendations";
import type { BackgroundRecord, ProductSummary } from "../shared/types";
import { safeChildPath } from "./fsUtils";

const cache = new Map<string, { signature: string; pack: BackgroundRecommendationsPack }>();
const MAX_PACK_BYTES = 4 * 1024 * 1024;

async function readPack(productRoot: string) {
  const filename = path.join(productRoot, ".product-shot-queue", BACKGROUND_RECOMMENDATIONS_FILENAME);
  const info = await fs.lstat(filename, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) { cache.delete(filename); return null; }
  if (!info.isFile() || info.size > BigInt(MAX_PACK_BYTES)) throw new Error("Invalid recommendation pack");
  const signature = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  const saved = cache.get(filename);
  if (saved?.signature === signature) return saved.pack;
  const pack = BackgroundRecommendationsPackSchema.parse(JSON.parse(await fs.readFile(filename, "utf8")));
  // Bound test/multi-catalog retention; cached packs are never handed to callers.
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(filename, { signature, pack });
  return pack;
}

export async function getProductBackgroundRecommendations({ productRoot, product, backgrounds, shotId }: {
  productRoot: string;
  product: ProductSummary;
  backgrounds: BackgroundRecord[];
  shotId?: string;
}): Promise<BackgroundRecommendationsResponse> {
  const empty: BackgroundRecommendationsResponse = { productId: product.id, status: "not_curated", curatedAt: null, unavailableCount: 0, recommendations: [] };
  if (shotId && !(BACKGROUND_REQUIRED_SHOT_IDS as readonly string[]).includes(shotId)) return { ...empty, status: "not_applicable" };
  let pack: BackgroundRecommendationsPack | null;
  try { pack = await readPack(productRoot); }
  catch { return { ...empty, status: "unavailable" }; }
  const entry = pack?.products.find(item => item.productId === product.id);
  if (!entry || !pack) return empty;
  empty.curatedAt = pack.curatedAt;
  if (product.status !== "ready" || entry.shape !== product.shape || entry.baseImage.file !== product.baseImage) return { ...empty, status: "stale" };
  const base = await fs.lstat(safeChildPath(safeChildPath(productRoot, product.id), entry.baseImage.file)).catch(() => null);
  // Source metadata survives Syncthing copies, unlike ctime. A changed base needs recuration.
  if (!base?.isFile() || base.size !== entry.baseImage.size || Math.trunc(base.mtimeMs) !== entry.baseImage.mtimeMs) return { ...empty, status: "stale" };
  const active = new Map(backgrounds.map(background => [background.id, background]));
  const recommendations = entry.recommendations.flatMap((item, index) => {
    const background = active.get(item.backgroundId);
    if (!background?.previewImagePath || !isBackgroundCompatibleForShot({ productShape: product.shape, shotId: shotId ?? "wide_room_hero", background })) return [];
    return [{ ...item, rank: index + 1 }];
  });
  return { ...empty, status: recommendations.length ? "ready" : "unavailable", unavailableCount: entry.recommendations.length - recommendations.length, recommendations };
}
