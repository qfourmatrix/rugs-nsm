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
  ProductSummary
} from "../shared/types";

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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? jsonHeaders : undefined),
      ...init.headers
    }
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

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

export async function getProductState(productId: string): Promise<ProductState> {
  const data = await request<unknown>(productPath(productId, "/state"));
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

export async function getGenerated(productId: string): Promise<GeneratedResponse> {
  const data = await request<unknown>(productPath(productId, "/generated"));
  const generated = unwrap<GeneratedResponse>(data, ["generated"]);

  return {
    active: generated?.active ?? [],
    trash: generated?.trash ?? [],
    aggregates: generated?.aggregates ?? {}
  };
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

export async function getJobs(): Promise<JobRecord[]> {
  const data = await request<unknown>("/api/jobs");
  return unwrap<JobRecord[]>(data, ["jobs", "items"]);
}

export async function generateFromPromptBox(
  productId: string,
  payload: {
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
