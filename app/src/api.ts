import type {
  AspectRatio,
  AppInfo,
  GeneratedResponse,
  BackgroundLibraryState,
  ImageSize,
  JobRecord,
  MasterShots,
  RefinePatternMode,
  RefineSettings,
  SosCustomPalette,
  SosPaletteId,
  ProductState,
  ProductSummary,
  AssetRecord,
  RoundEdgePolicy,
  ShapeVariantRecord,
  ShapeVariantShape,
  ShapeVariantStatus,
  ShapeVariantStrategy,
  GallerySelection,
  GalleryPreflight,
  GalleryExportJob,
  GalleryExportReceipt
} from "../shared/types";
import { isGenerationRoute } from "../shared/generation-routes";
import { prepareGenerationIntent } from "./generation-intent";

export interface ShapeVariantsOverview {
  records: ShapeVariantRecord[];
  counts: Record<ShapeVariantStatus, number>;
  plannedProviderCalls: number;
}

export interface ShapeVariantDetail {
  variant: ShapeVariantRecord;
  candidates: AssetRecord[];
}

export interface GenerateResponse {
  runId: string;
  jobIds: string[];
}

export interface GenerateSettings {
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(message: string, status: number, code = "API_ERROR", details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;

const jsonHeaders = {
  "Content-Type": "application/json"
};

const thumbnailCacheVersion = "jpg-v1";
const responseWeights = new WeakMap<object, number>();
const responseTags = new WeakMap<object, string>();
const generatedTags = new WeakMap<GeneratedResponse, { productId: string; tag: string }>();
export function responseCacheWeight(value: object) { return responseWeights.get(value) ?? Infinity; }

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, init: RequestInit = {}, unchanged?: T): Promise<T> {
  const intent = init.method === "POST" && isGenerationRoute(path)
    ? prepareGenerationIntent(window.localStorage, path, typeof init.body === "string" ? init.body : "null") : null;
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 120000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  try {
  const response = await fetch(path, {
    ...init,
    signal,
    headers: {
      ...(init.body ? jsonHeaders : undefined),
      ...init.headers,
      ...(intent ? { "Idempotency-Key": intent.key } : {})
    }
  });

  if (response.status === 304 && unchanged !== undefined) return unchanged;
  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;
  if (isObject(data)) responseWeights.set(data, text.length * 2);
  const tag = response.headers.get("ETag");
  if (isObject(data) && tag) responseTags.set(data, tag);
  if (response.headers.get("Idempotency-Status") === "complete") intent?.confirmed();

  if (!response.ok) {
    const errorPayload = isObject(data) && isObject(data.error) ? data.error : null;
    const message =
      errorPayload && typeof errorPayload.message === "string"
        ? errorPayload.message
        : `Request failed with HTTP ${response.status}`;
    const code =
      errorPayload && typeof errorPayload.code === "string"
        ? errorPayload.code
        : "HTTP_ERROR";

    throw new ApiError(message, response.status, code, data);
  }

  return data as T;
  } catch (error) {
    if (timeout.signal.aborted && !init.signal?.aborted) {
      const mutation = init.method && init.method !== "GET";
      throw new ApiError(mutation
        ? "The server did not confirm this action. It may still have completed. Check job history or reload before trying again; generation was not automatically retried."
        : "The server took too long to respond. Check that the studio is running, then refresh.", 408, "REQUEST_TIMEOUT");
    }
    throw error;
  } finally { window.clearTimeout(timer); }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrap<T>(data: unknown, keys: string[]): T {
  if (isObject(data)) {
    for (const key of keys) {
      if (key in data) {
        return data[key] as T;
      }
    }
  }

  return data as T;
}

function productPath(productId: string, suffix = "") {
  return `/api/products/${encodeURIComponent(productId)}${suffix}`;
}

export function imageUrl(
  productId: string,
  kind: "base" | "reference" | "generated" | "trash",
  filename: string
) {
  return productPath(productId, `/image/${kind}/${encodeURIComponent(filename)}`);
}

export function thumbnailUrl(
  productId: string,
  kind: "base" | "reference" | "generated" | "trash",
  filename: string
) {
  return `${productPath(productId, `/thumbnail/${kind}/${encodeURIComponent(filename)}`)}?v=${thumbnailCacheVersion}`;
}

export function backgroundPreviewUrl(backgroundId: string, fingerprint: string) {
  return `/api/background-library/preview/${encodeURIComponent(backgroundId)}?v=${encodeURIComponent(fingerprint)}`;
}

export async function getProducts(): Promise<ProductSummary[]> {
  const data = await request<unknown>("/api/products");
  return unwrap<ProductSummary[]>(data, ["products", "items"]);
}

export async function createProduct(name: string): Promise<ProductSummary> {
  const data = await request<unknown>("/api/products", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  return unwrap<ProductSummary>(data, ["product"]);
}

export async function getAppInfo(): Promise<AppInfo> {
  const data = await request<unknown>("/api/app-info");
  return unwrap<AppInfo>(data, ["appInfo", "info"]);
}

export async function getRefineSettings(): Promise<RefineSettings> {
  const data = await request<unknown>("/api/refine-settings");
  return unwrap<RefineSettings>(data, ["refineSettings", "settings"]);
}

export async function updateRefineSettings(mode: RefinePatternMode, prompt: string): Promise<RefineSettings> {
  const data = await request<unknown>("/api/refine-settings", {
    method: "PUT",
    body: JSON.stringify({ mode, prompt })
  });
  return unwrap<RefineSettings>(data, ["refineSettings", "settings"]);
}

export async function saveRecentSosPalette(palette: SosCustomPalette): Promise<RefineSettings> {
  const data = await request<unknown>("/api/refine-settings/sos-palettes", {
    method: "PUT",
    body: JSON.stringify({ palette })
  });
  return unwrap<RefineSettings>(data, ["refineSettings", "settings"]);
}

export async function getMasterShots(): Promise<MasterShots> {
  const data = await request<unknown>("/api/master-shots");
  return unwrap<MasterShots>(data, ["masterShots", "master"]);
}

export async function updateMasterShots(masterShots: MasterShots): Promise<MasterShots> {
  const data = await request<unknown>("/api/master-shots", {
    method: "PUT",
    body: JSON.stringify(masterShots)
  });
  return unwrap<MasterShots>(data, ["masterShots", "master"]);
}

export async function getBackgroundLibrary(): Promise<BackgroundLibraryState> {
  const data = await request<unknown>("/api/background-library");
  return unwrap<BackgroundLibraryState>(data, ["library"]);
}

export async function rescanBackgroundLibrary(): Promise<BackgroundLibraryState> {
  const data = await request<unknown>("/api/background-library/rescan", {
    method: "POST"
  });
  return unwrap<BackgroundLibraryState>(data, ["library"]);
}

export async function updateBackgroundManifest(manifestPath: string): Promise<BackgroundLibraryState> {
  const data = await request<unknown>("/api/background-library/manifest", {
    method: "PUT",
    body: JSON.stringify({ manifestPath })
  });
  return unwrap<BackgroundLibraryState>(data, ["library"]);
}

export async function updateLabelLogoPath(labelLogoPath: string): Promise<BackgroundLibraryState> {
  const data = await request<unknown>("/api/background-library/label-logo", {
    method: "PUT",
    body: JSON.stringify({ labelLogoPath })
  });
  return unwrap<BackgroundLibraryState>(data, ["library"]);
}

export async function getProductState(productId: string, signal?: AbortSignal): Promise<ProductState> {
  const data = await request<unknown>(productPath(productId, "/state"), { signal });
  return unwrap<ProductState>(data, ["state", "productState"]);
}

export async function updateProductState(
  productId: string,
  state: ProductState
): Promise<ProductState> {
  const data = await request<unknown>(productPath(productId, "/state"), {
    method: "PUT",
    body: JSON.stringify(state)
  });
  return unwrap<ProductState>(data, ["state", "productState"]);
}

export async function updateProductBackground(
  productId: string,
  backgroundId: string | null
): Promise<ProductState> {
  const data = await request<unknown>(productPath(productId, "/background"), {
    method: "PUT",
    body: JSON.stringify({ backgroundId })
  });
  return unwrap<ProductState>(data, ["state", "productState"]);
}

export async function getGenerated(productId: string, signal?: AbortSignal, previous?: GeneratedResponse): Promise<GeneratedResponse> {
  const saved = previous ? generatedTags.get(previous) : undefined;
  const reusable = saved?.productId === productId ? previous : undefined;
  const data = await request<unknown>(productPath(productId, "/generated?compact=1"), { signal,
    ...(reusable ? { headers: { "If-None-Match": saved!.tag }, cache: "no-store" as const } : {})
  }, reusable ? { generated: reusable } : undefined);
  const generated = unwrap<GeneratedResponse>(data, ["generated"]);
  if (reusable && generated === reusable) return reusable;

  const result = {
    active: generated?.active ?? [],
    trash: generated?.trash ?? [],
    aggregates: generated?.aggregates ?? {}
  };
  responseWeights.set(result, isObject(data) ? responseCacheWeight(data) : Infinity);
  const tag = isObject(data) ? responseTags.get(data) : undefined;
  if (tag?.startsWith('W/"generated-')) generatedTags.set(result, { productId, tag });
  return result;
}

export async function getGeneratedAsset(productId: string, assetId: string, signal?: AbortSignal): Promise<{ asset: AssetRecord; location: "generated" | "trash" }> {
  return request(productPath(productId, `/generated/${encodeURIComponent(assetId)}`), { signal });
}

export async function getCompletionPreview(productId: string, assetId: string, signal: AbortSignal): Promise<{ file: string | null }> {
  return request(productPath(productId, `/generated/${encodeURIComponent(assetId)}?preview=1`), { signal });
}

export async function getGallerySelection(productId: string): Promise<GallerySelection> {
  const data = await request<unknown>(productPath(productId, "/gallery"));
  return unwrap<GallerySelection>(data, ["gallery"]);
}

export async function updateGallerySelection(productId: string, assetIds: string[], expectedRevision?: number): Promise<GallerySelection> {
  const data = await request<unknown>(productPath(productId, "/gallery"), {
    method: "PUT",
    body: JSON.stringify({ assetIds, expectedRevision })
  });
  return unwrap<GallerySelection>(data, ["gallery"]);
}

export async function updateGalleryReadiness(productId: string, exportReady: boolean, expectedRevision: number): Promise<GallerySelection> {
  const data = await request<unknown>(productPath(productId, "/gallery/readiness"), {
    method: "PATCH",
    body: JSON.stringify({ exportReady, expectedRevision })
  });
  return unwrap<GallerySelection>(data, ["gallery"]);
}

export async function acceptAllDoneAssets(productId: string, assetIds: string[]) {
  return request<{ gallery: GallerySelection; results: { assetId: string; status: "accepted" | "already_accepted" | "skipped"; reason?: string }[] }>(productPath(productId, "/generated/accept-all"), {
    method: "POST",
    body: JSON.stringify({ assetIds })
  });
}

export async function preflightGalleryExport(productIds: string[]): Promise<GalleryPreflight> {
  const data = await request<unknown>("/api/gallery-exports/preflight", {
    method: "POST",
    body: JSON.stringify({ productIds })
  });
  return unwrap<GalleryPreflight>(data, ["preflight"]);
}

export async function startGalleryExport(productIds: string[], expectedFingerprints?: Record<string, string>): Promise<GalleryExportJob> {
  const data = await request<unknown>("/api/gallery-exports", {
    method: "POST",
    body: JSON.stringify({ productIds, expectedFingerprints })
  });
  return unwrap<GalleryExportJob>(data, ["exportJob"]);
}

export async function getGalleryExportJob(exportId: string, signal?: AbortSignal): Promise<GalleryExportJob> {
  const data = await request<unknown>(`/api/gallery-exports/${encodeURIComponent(exportId)}`, { signal });
  return unwrap<GalleryExportJob>(data, ["exportJob"]);
}

export type AvailableGalleryDownload = Pick<GalleryExportReceipt, "exportId" | "archiveFilename" | "archiveBytes" | "completedAt" | "includedShapes" | "skippedShapes">;

export async function getAvailableGalleryDownloads(signal?: AbortSignal): Promise<AvailableGalleryDownload[]> {
  const result = await request<{ downloads: AvailableGalleryDownload[] }>("/api/gallery-exports", { signal });
  return result.downloads;
}

export type GalleryReceiptSummary = Pick<GalleryExportReceipt, "exportId" | "completedAt" | "downloadedAt" | "archiveFilename" | "archiveBytes" | "includedShapes" | "skippedShapes">;
export async function getGalleryExportReceipts(signal?: AbortSignal, cursor?: string): Promise<{ receipts: GalleryReceiptSummary[]; nextCursor: string | null }> {
  return request(`/api/gallery-export-receipts/page?limit=8${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
}

export function galleryExportDownloadUrl(exportId: string) {
  return `/api/gallery-exports/${encodeURIComponent(exportId)}/download`;
}

export async function uploadRefineReference(
  productId: string,
  payload: {
    data: string;
    mimeType: string;
  }
): Promise<{ filename: string }> {
  const data = await request<unknown>(productPath(productId, "/refine-reference"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const reference = unwrap<{ filename: string }>(data, ["reference"]);
  return reference;
}

export async function startRefine(
  productId: string,
  imageSize: ImageSize,
  patternMode: RefinePatternMode,
  variationCount: number,
  sosPaletteId: SosPaletteId,
  sosCustomPalette: SosCustomPalette,
  sosDesignChange: boolean
): Promise<GenerateResponse> {
  return request<GenerateResponse>(productPath(productId, "/refine"), {
    method: "POST",
    body: JSON.stringify({ imageSize, patternMode, variationCount, sosPaletteId, sosCustomPalette, sosDesignChange })
  });
}

export async function validateRefineVariation(productId: string, assetId: string): Promise<ProductSummary> {
  const data = await request<unknown>(productPath(productId, `/refine/${encodeURIComponent(assetId)}/validate`), {
    method: "POST"
  });
  return unwrap<ProductSummary>(data, ["product"]);
}

export async function getJobs(signal?: AbortSignal, productId?: string): Promise<JobRecord[]> {
  const data = await request<unknown>(`/api/jobs${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`, { signal });
  return unwrap<JobRecord[]>(data, ["jobs", "items"]);
}

export async function getJobRevision(): Promise<string> {
  return (await request<{ revision: string }>("/api/jobs/revision")).revision;
}

export async function cancelGalleryExport(exportId: string): Promise<GalleryExportJob> {
  const data = await request<unknown>(`/api/gallery-exports/${encodeURIComponent(exportId)}/cancel`, { method: "POST" });
  return unwrap<GalleryExportJob>(data, ["exportJob"]);
}

export async function checkGenerationRequest(scope: string, key: string): Promise<{ state: string; responseStatus: number | null; response: unknown }> {
  return request(`/api/generation-requests/status?${new URLSearchParams({ scope, key })}`);
}

export async function getJobHistory(productId: string, before?: number, signal?: AbortSignal): Promise<{ jobs: JobRecord[]; nextCursor: number | null }> {
  const query = new URLSearchParams({ productId, limit: "25" });
  if (before !== undefined) query.set("before", String(before));
  return request(`/api/jobs/history?${query}`, { signal });
}

export async function generateFromPromptBox(
  productId: string,
  payload: {
    context?: Pick<ProductState, "selectedBackgroundId" | "selectedConstructionId">;
    shotId: string;
    prompt: string;
    settings: GenerateSettings;
    batchSize: number;
    referenceImages: string[];
  }
): Promise<GenerateResponse> {
  return request<GenerateResponse>(productPath(productId, "/generate"), {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      source: "prompt_box"
    })
  });
}

export async function generateMissing(
  productId: string,
  payload: {
    context?: Pick<ProductState, "selectedBackgroundId" | "selectedConstructionId">;
    settings: GenerateSettings;
    batchSize: number;
    referenceImages: string[];
  }
): Promise<GenerateResponse> {
  return request<GenerateResponse>(productPath(productId, "/generate-missing"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function retryFailed(
  productId: string,
  payload: {
    settings: GenerateSettings;
    batchSize: number;
    referenceImages: string[];
    shotIds?: string[];
  }
): Promise<GenerateResponse> {
  return request<GenerateResponse>(productPath(productId, "/retry-failed"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function retryAsset(productId: string, assetId: string) {
  return request(productPath(productId, `/generated/${encodeURIComponent(assetId)}/retry`), {
    method: "POST"
  });
}

export async function acceptAsset(productId: string, assetId: string) {
  return request(productPath(productId, `/generated/${encodeURIComponent(assetId)}/accept`), {
    method: "POST"
  });
}

export async function rejectAsset(productId: string, assetId: string) {
  return request(productPath(productId, `/generated/${encodeURIComponent(assetId)}/reject`), {
    method: "POST"
  });
}

export async function cancelJob(jobId: string) {
  return request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST"
  });
}

export async function getShapeVariants(): Promise<ShapeVariantsOverview> {
  const data = await request<unknown>("/api/shape-variants");
  return unwrap<ShapeVariantsOverview>(data, ["shapeVariants"]);
}

export async function prepareShapeVariants(payload: {
  sourceProductIds: string[];
  shapes: ShapeVariantShape[];
  strategy: ShapeVariantStrategy;
  runnerRatio: number;
  roundEdgePolicy: RoundEdgePolicy;
  imageSize: "2K" | "4K";
  candidateCount: 1 | 2;
}): Promise<{ records: ShapeVariantRecord[]; plannedProviderCalls: number }> {
  return request("/api/shape-variants/prepare", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function generateShapeVariants(ids: string[]) {
  return request<{ results: Array<{ id: string; runId?: string; jobIds?: string[]; error?: string }> }>(
    "/api/shape-variants/generate",
    { method: "POST", body: JSON.stringify({ ids }) }
  );
}

export async function getShapeVariant(id: string): Promise<ShapeVariantDetail> {
  return request(`/api/shape-variants/${encodeURIComponent(id)}`);
}

export async function approveShapeVariant(id: string, assetId: string) {
  return request<{ variant: ShapeVariantRecord; product: ProductSummary | null }>(
    `/api/shape-variants/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify({ assetId }) }
  );
}

export async function rejectShapeVariantCandidate(id: string, assetId: string) {
  return request<{ variant: ShapeVariantRecord }>(
    `/api/shape-variants/${encodeURIComponent(id)}/candidates/${encodeURIComponent(assetId)}/reject`,
    { method: "POST" }
  );
}

export async function generateShapeVariantShots(productIds: string[], imageSize: "2K" | "4K") {
  return request<{
    results: Array<{ productId: string; jobIds: string[]; blocked: Array<{ shotId: string; message: string }> }>;
    providerCallsQueued: number;
  }>("/api/shape-variants/generate-shots", {
    method: "POST",
    body: JSON.stringify({ productIds, imageSize })
  });
}
