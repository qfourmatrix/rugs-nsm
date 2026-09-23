import type {
  GeneratedResponse,
  BackgroundLibraryState,
  JobRecord,
  MasterShots,
  ProductState,
  ProductSummary,
  RugConstructionId,
  Shot,
  ShotAggregateState
} from "../../shared/types";
import type { AppMode, LocatedAsset } from "../types";
import { ComparePanel } from "./ComparePanel";
import { GeneratePanel } from "./GeneratePanel";

interface RightPanelProps {
  mode: AppMode;
  product: ProductSummary | null;
  masterShots: MasterShots | null;
  productState: ProductState | null;
  backgroundLibrary: BackgroundLibraryState | null;
  generated: GeneratedResponse;
  jobs: JobRecord[];
  selectedAsset: LocatedAsset | null;
  compareAssets: LocatedAsset[];
  onModeChange: (mode: AppMode) => void;
  onExportReadyChange: (ready: boolean) => void;
  onLoadShot: (shot: Shot) => void;
  savingState: boolean;
  busyAction: string | null;
  busyActions: ReadonlySet<string>;
  galleryBusy: boolean;
  runningShotIds: Set<string>;
  onPromptChange: (value: string) => void;
  onSettingsChange: (settings: Partial<ProductState["settings"]>) => void;
  onReferencesChange: (referenceImages: string[]) => void;
  onGeneratePrompt: (shotId: string) => void;
  onGenerateMissing: (count: number) => void;
  onRetryFailed: (shotIds: string[] | undefined, count: number) => void;
  onCancelPending: () => void;
  onMasterShotsSave: (masterShots: MasterShots) => void;
  onBackgroundManifestSave: (manifestPath: string) => void;
  onBackgroundLibraryRescan: () => void;
  onLabelLogoSave: (labelLogoPath: string) => void;
  onProductBackgroundChange: (backgroundId: string | null) => void;
  onConstructionChange: (constructionId: RugConstructionId | null) => void;
  onPreviousAsset: () => void;
  onNextAsset: () => void;
  onAccept: (assetId: string) => void;
  onReject: (assetId: string) => void;
  onRetry: (assetId: string) => void;
}

export function RightPanel({
  mode,
  product,
  masterShots,
  productState,
  backgroundLibrary,
  generated,
  jobs,
  selectedAsset,
  compareAssets,
  onModeChange,
  onExportReadyChange,
  onLoadShot,
  savingState,
  busyAction,
  busyActions,
  galleryBusy,
  runningShotIds,
  onPromptChange,
  onSettingsChange,
  onReferencesChange,
  onGeneratePrompt,
  onGenerateMissing,
  onRetryFailed,
  onCancelPending,
  onMasterShotsSave,
  onBackgroundManifestSave,
  onBackgroundLibraryRescan,
  onLabelLogoSave,
  onProductBackgroundChange,
  onConstructionChange,
  onPreviousAsset,
  onNextAsset,
  onAccept,
  onReject,
  onRetry
}: RightPanelProps) {
  return (
    <main className="rightPanel">
      <div className="studioReviewToolbar">
      <div className="modeSwitch" role="tablist" aria-label="Right panel mode">
        <button
          type="button"
          className={mode === "generate" ? "isActive" : ""}
          onClick={() => onModeChange("generate")}
        >
          Generate
        </button>
        <button
          type="button"
          className={mode === "compare" ? "isActive" : ""}
          onClick={() => onModeChange("compare")}
        >
          Compare
        </button>
      </div>
      <div className="exportReadinessControl" role="group" aria-label={`${product?.shape ?? "Shape"} export readiness`} aria-busy={busyActions.has("export-readiness")}>
        <span className="exportReadinessLabel">Export</span>
        <div className="exportReadinessSegments">
        <button type="button" className={!product?.exportReady ? "isActive" : ""} aria-pressed={!product?.exportReady}
          disabled={!product || Boolean(busyAction) || galleryBusy || Boolean(product.readinessError)} onClick={() => onExportReadyChange(false)}>Not ready</button>
        <button type="button" className={product?.exportReady ? "isActive" : ""} aria-pressed={Boolean(product?.exportReady)}
          disabled={!product || product.status !== "ready" || !product.baseImage || Boolean(busyAction) || galleryBusy || Boolean(product.readinessError)}
          title={product?.status !== "ready" ? "A valid main image is needed before marking this shape ready" : "Mark this shape ready for export"}
          onClick={() => onExportReadyChange(true)}>Ready</button>
        </div>
        {busyActions.has("export-readiness") ? <span role="status">Saving…</span> : null}
        {product?.readinessError ? <span role="alert">Readiness unavailable</span> : null}
      </div>
      </div>

      {mode === "generate" ? (
        <GeneratePanel
          product={product}
          masterShots={masterShots}
          productState={productState}
          backgroundLibrary={backgroundLibrary}
          aggregates={generated.aggregates as Record<string, ShotAggregateState>}
          jobs={jobs}
          savingState={savingState}
          busyAction={busyAction}
          busyActions={busyActions}
          runningShotIds={runningShotIds}
          onLoadShot={onLoadShot}
          onPromptChange={onPromptChange}
          onSettingsChange={onSettingsChange}
          onReferencesChange={onReferencesChange}
          onGeneratePrompt={onGeneratePrompt}
          onGenerateMissing={onGenerateMissing}
          onRetryFailed={onRetryFailed}
          onCancelPending={onCancelPending}
          onMasterShotsSave={onMasterShotsSave}
          onBackgroundManifestSave={onBackgroundManifestSave}
          onBackgroundLibraryRescan={onBackgroundLibraryRescan}
          onLabelLogoSave={onLabelLogoSave}
          onProductBackgroundChange={onProductBackgroundChange}
          onConstructionChange={onConstructionChange}
        />
      ) : (
        <ComparePanel
          product={product}
          selectedAsset={selectedAsset}
          assets={compareAssets}
          actionDisabled={Boolean(busyAction) || galleryBusy}
          retryDisabled={selectedAsset ? runningShotIds.has(selectedAsset.shotId) : false}
          onBackToGenerate={() => onModeChange("generate")}
          onPrevious={onPreviousAsset}
          onNext={onNextAsset}
          onAccept={onAccept}
          onReject={onReject}
          onRetry={onRetry}
        />
      )}
    </main>
  );
}
