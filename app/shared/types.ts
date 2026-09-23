import type { SosCustomPalette, SosPaletteId } from "./sos-palettes";

export type { SosCustomPalette, SosPaletteId } from "./sos-palettes";

export type ImageSize = "1K" | "2K" | "4K";
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type AssetStatus = "done" | "accepted" | "rejected" | "failed";
export type JobStatus = "queued" | "generating" | "succeeded" | "failed" | "cancelled";
export type ShotAggregateState = "empty" | "generating" | "accepted" | "review_needed" | "failed" | "rejected_only";
export type RugConstructionId = "flatweave" | "low_pile" | "high_pile" | "mixed_high_low" | "unknown_custom";
export type RefinePatternMode = "symmetrical" | "asymmetrical" | "sos";
export type ProductShape = "area" | "runner" | "round";
export type RunnerRoomShotId = "wide_room_hero" | "high_angle_lifestyle";
export type RunnerBackgroundArchetype =
  | "long_hallway_gallery"
  | "entry_foyer_lane"
  | "open_living_circulation"
  | "bedside_passage"
  | "kitchen_galley_transition"
  | "stair_landing_corridor";
export type ShapeVariantShape = Exclude<ProductShape, "area">;
export type ShapeVariantStrategy = "auto" | "repeat_border" | "endcap" | "stripe_band" | "focal" | "asymmetrical";
export type RoundEdgePolicy = "bound" | "preserve_source" | "radial_fringe";
export type ShapeVariantStatus =
  | "planned"
  | "queued"
  | "generating"
  | "needs_review"
  | "approved"
  | "failed"
  | "cancelled"
  | "stale";

export interface Shot {
  id: string;
  name: string;
  prompt: string;
  backgroundTypeOverrides?: Record<string, ShotPromptOverride>;
  defaultAspectRatio: AspectRatio;
  defaultImageSize: ImageSize;
}

export interface ShotPromptOverride {
  scene: string;
  rug_placement: string;
  camera: string;
  lighting?: string;
  styling?: string;
  quality?: string;
  output_requirements?: string;
}

export interface MasterShots {
  version: 1;
  updatedAt: string;
  shots: Shot[];
}

export interface RefineSettings {
  version: 3;
  prompts: Record<RefinePatternMode, string>;
  defaultPrompts: Record<RefinePatternMode, string>;
  recentSosPalettes: SosCustomPalette[];
  updatedAt: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  shape: ProductShape;
  familyId: string;
  sourceProductId: string;
  createdAt: string;
  status: "ready" | "missing_base" | "duplicate_base" | "invalid_variant";
  baseImage: string | null;
  referenceImages: string[];
  exportReady?: boolean;
  galleryRevision?: number;
  readinessError?: string;
  counts: {
    totalShots: number;
    accepted: number;
    reviewNeeded: number;
    failed: number;
    running: number;
  };
  errors: string[];
}

export interface ShapeVariantMetadata {
  version: 1;
  familyId: string;
  sourceProductId: string;
  shape: ShapeVariantShape;
  sourceBaseSha256: string;
  approvedAssetId: string;
  promptVersion: string;
  createdAt: string;
}

export interface ShapeVariantDerivation {
  familyId: string;
  sourceProductId: string;
  variantProductId: string;
  shape: ShapeVariantShape;
  strategy: ShapeVariantStrategy;
  runnerRatio: number | null;
  roundEdgePolicy: RoundEdgePolicy | null;
  promptVersion: string;
  runId: string;
}

export interface ShapeVariantRecord {
  id: string;
  familyId: string;
  sourceProductId: string;
  variantProductId: string;
  shape: ShapeVariantShape;
  status: ShapeVariantStatus;
  strategy: ShapeVariantStrategy;
  runnerRatio: number | null;
  roundEdgePolicy: RoundEdgePolicy | null;
  imageSize: Extract<ImageSize, "2K" | "4K">;
  candidateCount: 1 | 2;
  sourceBaseFile: string;
  sourceBaseSha256: string;
  promptVersion: string;
  prompt: string;
  candidateAssetIds: string[];
  approvedAssetId: string | null;
  activeRunId: string | null;
  requestedCandidateCount: number;
  completedCandidateCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShapeVariantCampaign {
  version: 1;
  updatedAt: string;
  variants: ShapeVariantRecord[];
}

export interface ShapeVariantSummary {
  records: ShapeVariantRecord[];
  counts: Record<ShapeVariantStatus, number>;
}

export interface ProductState {
  revision?: number;
  version: 1;
  productId: string;
  createdAt: string;
  selectedShotId: string | null;
  selectedAssetId: string | null;
  selectedBackgroundId: string | null;
  selectedConstructionId: RugConstructionId | null;
  refinePatternMode: RefinePatternMode;
  refineVariationCount: number;
  sosPaletteId: SosPaletteId;
  sosCustomPalette: SosCustomPalette;
  sosDesignChange: boolean;
  referenceImages: string[];
  promptBox: {
    value: string;
    sourceShotId: string | null;
    dirty: boolean;
    updatedAt: string;
  };
  settings: {
    aspectRatio: AspectRatio;
    imageSize: ImageSize;
    concurrency: number;
    batchSize: number;
  };
}

export interface BackgroundRecord {
  id: string;
  type: string;
  title: string;
  runnerArchetype: RunnerBackgroundArchetype | null;
  runnerShotCompatibility: RunnerRoomShotId[];
  previewImagePath: string | null;
  promptPath: string | null;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  usedAt: string | null;
  useCount: number;
  status: "new" | "used";
}

export interface BackgroundLibraryState {
  manifestPath: string | null;
  manifestMtimeMs: number | null;
  manifestSha256: string | null;
  scannedAt: string | null;
  labelLogoPath: string | null;
  labelLogoExists: boolean;
  backgrounds: BackgroundRecord[];
  errors: string[];
}

export interface GenerationBackgroundSnapshot {
  id: string;
  type: string;
  title: string;
  prompt: string;
  previewImagePath: string | null;
  runnerArchetype?: RunnerBackgroundArchetype | null;
  runnerShotCompatibility?: RunnerRoomShotId[];
}

export interface GenerationLabelLogoSnapshot {
  file: string;
  path: string;
  sha256: string;
  mimeType: string;
}

export interface RugConstructionOption {
  id: RugConstructionId;
  name: string;
  summary: string;
  prompt: string;
}

export interface GenerationConstructionSnapshot {
  id: RugConstructionId;
  name: string;
  prompt: string;
}

export interface AssetRecord {
  /** Read-only list projection. Prompt/background prompt/raw error are unloaded, not empty source values. */
  detailsOmitted?: true;
  detailsRevision?: string;
  version: 1;
  assetId: string;
  productId: string;
  shotId: string;
  shotName: string;
  status: AssetStatus;
  attempt: number;
  parentAssetId: string | null;
  createdAt: string;
  prompt: string;
  masterShotsVersion?: number;
  settings: {
    provider: "mock" | "laozhang";
    model: string;
    aspectRatio: AspectRatio;
    imageSize: ImageSize;
  };
  inputs: {
    baseImage: {
      file: string;
      sha256: string;
      sizeBytes: number;
      mtimeMs: number;
      mimeType: string;
    };
    references: string[];
    background?: GenerationBackgroundSnapshot | null;
    labelLogo?: GenerationLabelLogoSnapshot | null;
    construction?: GenerationConstructionSnapshot | null;
    shapeVariant?: ShapeVariantDerivation | null;
  };
  output: {
    file: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
  provider: {
    requestId: string | null;
    durationMs: number;
    normalizedStatus: string;
    requestPreview: {
      responseModalities: string[];
      aspectRatio: AspectRatio;
      imageSize: ImageSize;
      inputImageCount: number;
    };
  };
  error: {
    message: string;
    code: string;
    raw: unknown;
  } | null;
}

export interface GeneratedResponse {
  active: AssetRecord[];
  trash: AssetRecord[];
  aggregates: Record<string, ShotAggregateState>;
}

export interface GallerySelection {
  version: 2;
  productId: string;
  assetIds: string[];
  initializedAt: string;
  updatedAt: string;
  revision: number;
  exportReady: boolean;
  readyAt: string | null;
  reviewedContent: {
    fingerprint: string;
    files: { path: string; size: number; mtimeMs: number; ctimeMs: number; sha256: string }[];
  } | null;
}

export interface BulkAcceptResult {
  gallery: GallerySelection;
  results: { assetId: string; status: "accepted" | "already_accepted" | "skipped"; reason?: string }[];
}

export type GalleryIssueSeverity = "warning" | "blocker";

export interface GalleryPreflightIssue {
  code: string;
  severity: GalleryIssueSeverity;
  message: string;
  productId: string;
  familyId: string;
  shape: ProductShape;
  assetId?: string;
}

export interface GalleryPreflightShape {
  productId: string;
  familyId: string;
  shape: ProductShape;
  status: "ready" | "skipped";
  itemCount: number;
  issues: GalleryPreflightIssue[];
  contentFingerprint?: string;
  exportReady?: boolean;
  galleryRevision?: number;
}

export interface GalleryPreflight {
  version: 1;
  checkedAt: string;
  productIds: string[];
  shapes: GalleryPreflightShape[];
  readyCount: number;
  skippedCount: number;
}

export interface ExportImageDimensions {
  width: number;
  height: number;
}

export interface GalleryExportImageReceipt {
  position: number;
  role: "main" | "generated";
  assetId: string | null;
  shotId: string;
  shotName: string;
  sourceFile: string;
  originalFilename: string;
  shopifyFilename: string;
  sourceDimensions: ExportImageDimensions;
  outputDimensions: ExportImageDimensions;
  sourceBytes: number;
  outputBytes: number;
  sourceSha256: string;
  outputSha256: string;
}

export interface GalleryExportShapeReceipt {
  exportReady?: boolean;
  galleryRevision?: number;
  productId: string;
  familyId: string;
  shape: ProductShape;
  status: "included" | "skipped";
  issues: GalleryPreflightIssue[];
  images: GalleryExportImageReceipt[];
}

export interface GalleryExportEncoderSettings {
  format: "webp";
  preset: "photo";
  quality: 90;
  effort: 6;
  smartSubsample: true;
  colourSpace: "srgb";
  maximumDimension: 4096;
  maximumBytes: 20971520;
  withoutEnlargement: true;
  metadata: "stripped";
}

export interface GalleryExportReceipt {
  version: 1;
  exportId: string;
  archiveFilename: string;
  createdAt: string;
  completedAt: string;
  downloadedAt: string | null;
  requestedProductIds: string[];
  notSelectedShapes?: { productId: string; familyId: string; shape: ProductShape }[];
  encoder: GalleryExportEncoderSettings;
  shapes: GalleryExportShapeReceipt[];
  includedShapes: number;
  skippedShapes: number;
  archiveBytes: number;
  archiveSha256: string;
}

export type GalleryExportJobStatus = "queued" | "building" | "ready" | "failed" | "downloaded" | "cancelled";

export interface GalleryExportJob {
  exportId: string;
  status: GalleryExportJobStatus;
  createdAt: string;
  updatedAt: string;
  archiveFilename: string | null;
  progress: {
    completed: number;
    total: number;
    message: string;
  };
  error: string | null;
  receipt: GalleryExportReceipt | null;
}

export interface JobRecord {
  jobId: string;
  runId: string;
  productId: string;
  shotId: string;
  shotName?: string;
  batchIndex?: number;
  batchTotal?: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
  assetId?: string;
}

export interface AppInfo {
  productRoot: string;
  providerMode: "mock" | "laozhang";
  providerReady: boolean;
  queueConcurrency: number;
  endpointHost: string | null;
}
