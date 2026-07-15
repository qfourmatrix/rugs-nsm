import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Clock3,
  Download,
  FolderOpen,
  Layers,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BACKGROUND_REQUIRED_SHOT_IDS, LABEL_REQUIRED_SHOT_IDS, RUG_CONSTRUCTION_OPTIONS } from "../../shared/constants";
import type {
  BackgroundLibraryState,
  BackgroundRecord,
  JobRecord,
  MasterShots,
  ProductState,
  ProductSummary,
  RugConstructionId,
  Shot,
  ShotAggregateState
} from "../../shared/types";
import { backgroundPreviewUrl, thumbnailUrl } from "../api";
import { aggregateLabels, isProductGeneratable, pluralize, truncate } from "../utils";
import { MasterShotEditor } from "./MasterShotEditor";
import { PromptSettings } from "./PromptSettings";

const BACKGROUND_PAGE_SIZE = 48;

function backgroundStatusLabel(status: BackgroundRecord["status"]) {
  return status === "new" ? "New" : "Used";
}

function shuffleBackgroundIds(ids: string[], previousOrder: string[] | null) {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }

  const comparison = previousOrder?.length === ids.length ? previousOrder : ids;
  if (shuffled.length > 1 && shuffled.every((id, index) => id === comparison[index])) {
    shuffled.push(shuffled.shift() as string);
  }

  return shuffled;
}

interface GeneratePanelProps {
  product: ProductSummary | null;
  masterShots: MasterShots | null;
  productState: ProductState | null;
  backgroundLibrary: BackgroundLibraryState | null;
  aggregates: Record<string, ShotAggregateState>;
  jobs: JobRecord[];
  savingState: boolean;
  busyAction: string | null;
  runningShotIds: Set<string>;
  onLoadShot: (shot: Shot) => void;
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
}

export function GeneratePanel({
  product,
  masterShots,
  productState,
  backgroundLibrary,
  aggregates,
  jobs,
  savingState,
  busyAction,
  runningShotIds,
  onLoadShot,
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
  onConstructionChange
}: GeneratePanelProps) {
  const shots = masterShots?.shots ?? [];
  const missingShots = shots.filter((shot) => (aggregates[shot.id] ?? "empty") === "empty");
  const missingCount = missingShots.length;
  const failedShots = shots.filter((shot) => (aggregates[shot.id] ?? "empty") === "failed");
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "generating");
  const settings = productState?.settings;
  const batchSize = settings?.batchSize ?? 1;
  const selectedReferences = productState?.referenceImages ?? [];
  const validSelectedReferences = product
    ? selectedReferences.filter((filename) => product.referenceImages.includes(filename))
    : [];
  const canGenerate = isProductGeneratable(product) && Boolean(productState) && shots.length > 0;
  const selectedShot = shots.find((shot) => shot.id === productState?.selectedShotId) ?? null;
  const selectedBackground = backgroundLibrary?.backgrounds.find((item) => item.id === productState?.selectedBackgroundId) ?? null;
  const selectedAggregate = selectedShot ? aggregates[selectedShot.id] ?? "empty" : "empty";
  const promptReady = Boolean(productState?.promptBox.value.trim());
  const selectedShotRunning = selectedShot ? runningShotIds.has(selectedShot.id) : false;
  const selectedRequirement = shotRequirementBlocker(selectedShot, productState, backgroundLibrary);
  const missingRequirement =
    missingShots.map((shot) => shotRequirementBlocker(shot, productState, backgroundLibrary)).find(Boolean) ?? null;
  const canGenerateSelected =
    !busyAction && canGenerate && Boolean(selectedShot) && promptReady && !selectedShotRunning && !selectedRequirement;
  const canGenerateMissing = !busyAction && canGenerate && missingCount > 0 && !missingRequirement;
  const selectedImageCount = selectedShot ? batchSize : 0;
  const readinessText = generationReadiness({
    product,
    canGenerate,
    selectedShot,
    promptReady,
    selectedShotRunning,
    selectedRequirement,
    busyAction,
    batchSize,
    referenceCount: validSelectedReferences.length
  });

  return (
    <section className="generatePanel">
      <div className="modeHeader">
        <div>
          <h2>Generate</h2>
          <p>
            Base image plus selected prompt - {settings?.aspectRatio ?? "1:1"} -{" "}
            {settings?.imageSize ?? "4K"} - batch x{batchSize}
          </p>
        </div>
        <div className="bulkActions">
          <button
            className="controlButton primary"
            type="button"
            disabled={!canGenerateMissing}
            onClick={() => onGenerateMissing(missingCount)}
            title={missingRequirement ?? "Generate every empty shot using the current aspect, size, and batch count."}
          >
            <Play size={15} />
            <span>Generate Missing ({formatBatchCount(missingCount, batchSize)})</span>
          </button>
          <button
            className="controlButton"
            type="button"
            disabled={Boolean(busyAction) || !canGenerate || failedShots.length === 0}
            onClick={() => onRetryFailed(undefined, failedShots.length)}
          >
            <RotateCcw size={15} />
            <span>Retry Failed ({formatBatchCount(failedShots.length, batchSize)})</span>
          </button>
          <button
            className="controlButton"
            type="button"
            disabled={Boolean(busyAction) || activeJobs.length === 0}
            onClick={onCancelPending}
          >
            <Ban size={15} />
            <span>Cancel Active</span>
          </button>
        </div>
      </div>

      {!product ? (
        <div className="emptyState">
          <Clock3 size={24} />
          <strong>No product selected</strong>
          <span>Select a product tab to load its master shots.</span>
        </div>
      ) : null}

      {product && !isProductGeneratable(product) ? (
        <div className="inlineAlert large">
          <AlertTriangle size={16} />
          <span>
            {product.status === "missing_base"
              ? "Add exactly one supported base.* image before generating."
              : "Remove duplicate base images before generating."}
          </span>
        </div>
      ) : null}

      {product && shots.length === 0 ? (
        <div className="emptyState">
          <Download size={24} />
          <strong>No master shots loaded</strong>
          <span>Reload or fix master-shots.json, then rescan.</span>
        </div>
      ) : null}

      {product ? (
        <div className="composerStack">
          <CurrentShotCommandBar
            selectedShot={selectedShot}
            aggregate={selectedAggregate}
            settingsSummary={`${settings?.aspectRatio ?? "1:1"} / ${settings?.imageSize ?? "4K"} / batch x${batchSize}`}
            readinessText={readinessText}
            imageCount={selectedImageCount}
            canGenerate={canGenerateSelected}
            onGenerate={() => selectedShot && onGeneratePrompt(selectedShot.id)}
          />

          <PromptSettings
            state={productState}
            selectedShotName={selectedShot?.name ?? null}
            saving={savingState}
            title="Settings"
            onPromptChange={onPromptChange}
            onSettingsChange={onSettingsChange}
            settingsExtra={
              <InlineConstructionControl
                state={productState}
                disabled={Boolean(busyAction) || !productState}
                onConstructionChange={onConstructionChange}
              />
            }
          />

          <BackgroundLibraryPanel
            product={product}
            library={backgroundLibrary}
            selectedBackground={selectedBackground}
            selectedBackgroundId={productState?.selectedBackgroundId ?? null}
            disabled={Boolean(busyAction) || !productState}
            onManifestSave={onBackgroundManifestSave}
            onRescan={onBackgroundLibraryRescan}
            onLabelLogoSave={onLabelLogoSave}
            onBackgroundChange={onProductBackgroundChange}
          />

          {shots.length > 0 ? (
            <ShotsPanel
              shots={shots}
              masterShots={masterShots}
              productState={productState}
              busyAction={busyAction}
              canGenerate={canGenerate}
              aggregates={aggregates}
              onLoadShot={onLoadShot}
              onMasterShotsSave={onMasterShotsSave}
            />
          ) : null}

          <RequirementsPanel
            selectedShot={selectedShot}
            productState={productState}
            backgroundLibrary={backgroundLibrary}
            selectedBackground={selectedBackground}
          />

          <ReferenceSelector
            product={product}
            selectedReferences={validSelectedReferences}
            disabled={Boolean(busyAction) || !productState}
            onReferencesChange={onReferencesChange}
          />

        </div>
      ) : null}
    </section>
  );
}

function ShotsPanel({
  shots,
  masterShots,
  productState,
  busyAction,
  canGenerate,
  aggregates,
  onLoadShot,
  onMasterShotsSave
}: {
  shots: Shot[];
  masterShots: MasterShots | null;
  productState: ProductState | null;
  busyAction: string | null;
  canGenerate: boolean;
  aggregates: Record<string, ShotAggregateState>;
  onLoadShot: (shot: Shot) => void;
  onMasterShotsSave: (masterShots: MasterShots) => void;
}) {
  return (
    <div className="shotsPanel" aria-label="Master shot list">
      <div className="sectionHeader">
        <div>
          <h3>Shots</h3>
          <p>{pluralize(shots.length, "template")} ready for this product.</p>
        </div>
        {masterShots ? (
          <MasterShotEditor
            masterShots={masterShots}
            disabled={Boolean(busyAction)}
            onSave={onMasterShotsSave}
          />
        ) : null}
      </div>

      <div className="shotList">
        {shots.map((shot, index) => (
          <ShotRow
            key={shot.id}
            shot={shot}
            index={index}
            requiresBackground={requiresBackground(shot.id)}
            requiresLabel={requiresLabel(shot.id)}
            hasLabelWorkflow={hasBlankLabelWorkflow(shot.id)}
            aggregate={aggregates[shot.id] ?? "empty"}
            selected={productState?.selectedShotId === shot.id}
            disabled={Boolean(busyAction) || !canGenerate}
            onLoadShot={onLoadShot}
          />
        ))}
      </div>
    </div>
  );
}

function CurrentShotCommandBar({
  selectedShot,
  aggregate,
  settingsSummary,
  readinessText,
  imageCount,
  canGenerate,
  onGenerate
}: {
  selectedShot: Shot | null;
  aggregate: ShotAggregateState;
  settingsSummary: string;
  readinessText: string;
  imageCount: number;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const isGenerating = aggregate === "generating";

  return (
    <section className="currentShotCommandBar" aria-label="Current shot">
      <div className="currentShotIdentity">
        <span className="eyebrow">Current shot</span>
        <strong>{selectedShot?.name ?? "Pick a shot below"}</strong>
      </div>

      <div className="currentShotSummary">
        <span className={`aggregatePill aggregate-${aggregate}`}>
          {isGenerating ? <LoaderCircle className="spin" size={12} /> : null}
          {aggregateLabels[aggregate]}
        </span>
        <span>{settingsSummary}</span>
      </div>

      <div className="currentShotAction">
        <span>{readinessText}</span>
        <button
          className="controlButton primary"
          type="button"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          <Sparkles size={15} />
          <span>Generate Selected{imageCount > 1 ? ` x${imageCount}` : ""}</span>
        </button>
      </div>
    </section>
  );
}

function formatBatchCount(shotCount: number, batchSize: number) {
  if (shotCount === 0 || batchSize === 1) return String(shotCount);
  return `${shotCount} x ${batchSize} = ${shotCount * batchSize}`;
}

function generationReadiness({
  product,
  canGenerate,
  selectedShot,
  promptReady,
  selectedShotRunning,
  selectedRequirement,
  busyAction,
  batchSize,
  referenceCount
}: {
  product: ProductSummary | null;
  canGenerate: boolean;
  selectedShot: Shot | null;
  promptReady: boolean;
  selectedShotRunning: boolean;
  selectedRequirement: string | null;
  busyAction: string | null;
  batchSize: number;
  referenceCount: number;
}) {
  if (busyAction) return `Working: ${busyAction}.`;
  if (!product) return "Select a product first.";
  if (!canGenerate) return "Fix the product base image before generating.";
  if (!selectedShot) return "Load a shot to fill the prompt box.";
  if (!promptReady) return "Prompt is empty.";
  if (selectedShotRunning) return `${selectedShot.name} is already queued or generating.`;
  if (selectedRequirement) return selectedRequirement;
  return `Uses current prompt, settings, base image, ${referenceCount} reference${referenceCount === 1 ? "" : "s"}, and batch x${batchSize}.`;
}

function requiresBackground(shotId: string) {
  return (BACKGROUND_REQUIRED_SHOT_IDS as readonly string[]).includes(shotId);
}

function requiresLabel(shotId: string) {
  return (LABEL_REQUIRED_SHOT_IDS as readonly string[]).includes(shotId);
}

function hasBlankLabelWorkflow(shotId: string) {
  return shotId === "folded_label_detail";
}

function shotRequirementBlocker(
  shot: Shot | null,
  state: ProductState | null,
  library: BackgroundLibraryState | null
) {
  if (!shot) return null;
  if (requiresBackground(shot.id) && !state?.selectedBackgroundId) {
    return `${shot.name} needs a selected background.`;
  }
  if (requiresLabel(shot.id) && !library?.labelLogoExists) {
    return `${shot.name} needs a configured label-logo image.`;
  }
  return null;
}

function InlineConstructionControl({
  state,
  disabled,
  onConstructionChange
}: {
  state: ProductState | null;
  disabled: boolean;
  onConstructionChange: (constructionId: RugConstructionId | null) => void;
}) {
  const selected = RUG_CONSTRUCTION_OPTIONS.find((item) => item.id === state?.selectedConstructionId) ?? null;
  const helper = selected
    ? selected.summary
    : "No pile override is added. The supplied rug image remains the only product identity source.";
  const promptPreview = selected
    ? selected.prompt
    : "No pile override is added. Use the rug reference image visually; do not add product description text.";

  return (
    <fieldset className="segmentedField constructionField">
      <legend>
        <Layers size={14} />
        Construction
      </legend>
      <div className="constructionInlineControl">
        <select
          value={state?.selectedConstructionId ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value as RugConstructionId | "";
            onConstructionChange(value ? value : null);
          }}
        >
          <option value="">Infer from base</option>
          {RUG_CONSTRUCTION_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <details className="constructionDetails">
          <summary title={helper}>Info</summary>
          <p>{truncate(promptPreview, 260)}</p>
        </details>
      </div>
    </fieldset>
  );
}

function RequirementsPanel({
  selectedShot,
  productState,
  backgroundLibrary,
  selectedBackground
}: {
  selectedShot: Shot | null;
  productState: ProductState | null;
  backgroundLibrary: BackgroundLibraryState | null;
  selectedBackground: BackgroundRecord | null;
}) {
  const selectedConstruction =
    RUG_CONSTRUCTION_OPTIONS.find((item) => item.id === productState?.selectedConstructionId) ?? null;
  const backgroundNeeded = selectedShot ? requiresBackground(selectedShot.id) : false;
  const labelNeeded = selectedShot ? requiresLabel(selectedShot.id) : false;
  const blankLabelWorkflow = selectedShot ? hasBlankLabelWorkflow(selectedShot.id) : false;
  const backgroundBlocked = backgroundNeeded && !selectedBackground;
  const labelBlocked = labelNeeded && !backgroundLibrary?.labelLogoExists;

  return (
    <section className="requirementsPanel" aria-label="Shot requirements">
      <div className="sectionHeader compactReferenceHeader">
        <div>
          <h3>Requirements</h3>
          <p>{selectedShot ? selectedShot.name : "Load a shot to see requirements."}</p>
        </div>
      </div>

      <div className="requirementsList">
        <RequirementRow
          label="Background"
          state={backgroundBlocked ? "blocked" : backgroundNeeded ? "ready" : "neutral"}
          text={
            !selectedShot
              ? "No shot loaded."
              : backgroundBlocked
                ? `${selectedShot.name} requires background.`
                : backgroundNeeded && selectedBackground
                  ? `${selectedBackground.title} / ${selectedBackground.status}`
                  : "Not required for this shot."
          }
        />
        <RequirementRow
          label="Label"
          state={labelBlocked ? "blocked" : labelNeeded || blankLabelWorkflow ? "ready" : "neutral"}
          text={
            !selectedShot
              ? "No shot loaded."
              : labelBlocked
                ? `${selectedShot.name} requires label-logo setup.`
                : blankLabelWorkflow
                  ? "Blank sewn label / post-composite."
                  : labelNeeded
                    ? "Post-composite label configured."
                    : "Not required for this shot."
          }
        />
        <RequirementRow
          label="Construction"
          state="ready"
          text={selectedConstruction ? `Override: ${selectedConstruction.name}.` : "Infer from base."}
        />
      </div>
    </section>
  );
}

function RequirementRow({
  label,
  state,
  text
}: {
  label: string;
  state: "blocked" | "ready" | "neutral";
  text: string;
}) {
  return (
    <div className={`requirementRow is-${state}`}>
      <strong>{label}</strong>
      <span>{text}</span>
    </div>
  );
}

function BackgroundLibraryPanel({
  product,
  library,
  selectedBackground,
  selectedBackgroundId,
  disabled,
  onManifestSave,
  onRescan,
  onLabelLogoSave,
  onBackgroundChange
}: {
  product: ProductSummary | null;
  library: BackgroundLibraryState | null;
  selectedBackground: BackgroundRecord | null;
  selectedBackgroundId: string | null;
  disabled: boolean;
  onManifestSave: (manifestPath: string) => void;
  onRescan: () => void;
  onLabelLogoSave: (labelLogoPath: string) => void;
  onBackgroundChange: (backgroundId: string | null) => void;
}) {
  const [manifestDraft, setManifestDraft] = useState(library?.manifestPath ?? "");
  const [labelDraft, setLabelDraft] = useState(library?.labelLogoPath ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "used" | "living" | "bedroom">("all");
  const [query, setQuery] = useState("");
  const [shuffledBackgroundIds, setShuffledBackgroundIds] = useState<string[] | null>(null);
  const [visibleBackgroundCount, setVisibleBackgroundCount] = useState(BACKGROUND_PAGE_SIZE);

  useEffect(() => {
    setManifestDraft(library?.manifestPath ?? "");
    setLabelDraft(library?.labelLogoPath ?? "");
    setShuffledBackgroundIds(null);
  }, [library?.labelLogoPath, library?.manifestPath]);

  useEffect(() => {
    setVisibleBackgroundCount(BACKGROUND_PAGE_SIZE);
  }, [filter, pickerOpen, query, shuffledBackgroundIds]);

  const backgrounds = library?.backgrounds ?? [];
  const orderedBackgrounds = useMemo(() => {
    if (!shuffledBackgroundIds) return backgrounds;
    const byId = new Map(backgrounds.map((background) => [background.id, background]));
    const shuffled = shuffledBackgroundIds.flatMap((id) => {
      const background = byId.get(id);
      if (!background) return [];
      byId.delete(id);
      return [background];
    });
    return [...shuffled, ...byId.values()];
  }, [backgrounds, shuffledBackgroundIds]);
  const filteredBackgrounds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orderedBackgrounds.filter((background) => {
      const type = background.type.toLowerCase();
      const matchesFilter =
        filter === "all" ||
        background.status === filter ||
        (filter === "living" && type.includes("living")) ||
        (filter === "bedroom" && type.includes("bed"));
      const matchesQuery =
        !normalizedQuery ||
        background.title.toLowerCase().includes(normalizedQuery) ||
        background.type.toLowerCase().includes(normalizedQuery) ||
        background.id.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, orderedBackgrounds, query]);
  const visibleBackgrounds = filteredBackgrounds.slice(0, visibleBackgroundCount);
  const remainingBackgroundCount = filteredBackgrounds.length - visibleBackgrounds.length;
  const shuffleBackgrounds = () => {
    setShuffledBackgroundIds((current) => shuffleBackgroundIds(backgrounds.map((background) => background.id), current));
    setPickerOpen(true);
  };

  return (
    <section className="backgroundPanel" aria-label="Background library">
      <div className="sectionHeader compactReferenceHeader">
        <div>
          <h3>Background</h3>
          <p>{library?.manifestPath ? `${backgrounds.length} backgrounds available` : "No manifest connected"}</p>
        </div>
      </div>

      <div className="selectedBackgroundCard backgroundSelectionCard">
        <div className="selectedBackgroundThumb">
          {selectedBackground?.previewImagePath ? (
            <img
              src={backgroundPreviewUrl(selectedBackground.id, selectedBackground.fingerprint)}
              alt={`${selectedBackground.title} preview`}
              loading="lazy"
            />
          ) : (
            <span>No preview</span>
          )}
        </div>
        <div>
          <span className="eyebrow">Selected rug background</span>
          <strong>{selectedBackground?.title ?? "None selected"}</strong>
          <p>
            {selectedBackground
              ? `${selectedBackground.type} - ${backgroundStatusLabel(selectedBackground.status)}`
              : product
                ? "Required before generating the two interior shots."
                : "Select a product first."}
          </p>
        </div>
        <div className="backgroundSelectionActions">
          {selectedBackground ? (
            <span className={`statusPill status-${selectedBackground.status}`}>
              {backgroundStatusLabel(selectedBackground.status)}
            </span>
          ) : null}
          <button
            className="controlButton"
            type="button"
            title="Open backgrounds in a random order"
            disabled={disabled || backgrounds.length === 0 || !product}
            onClick={shuffleBackgrounds}
          >
            <Shuffle size={15} />
            <span>Shuffle</span>
          </button>
          <button
            className="controlButton"
            type="button"
            disabled={disabled || backgrounds.length === 0 || !product}
            onClick={() => {
              setShuffledBackgroundIds(null);
              setPickerOpen(true);
            }}
          >
            <Search size={15} />
            <span>Choose Background</span>
          </button>
        </div>
      </div>

      <details className="libraryManageDrawer">
        <summary>Manage Library</summary>

        <div className="libraryManageContent">
          <div className="libraryConfigGrid">
            <label>
              <span>Manifest JSONL path</span>
              <div className="pathInputRow">
                <input
                  value={manifestDraft}
                  disabled={disabled}
                  placeholder="/absolute/path/backgrounds.jsonl"
                  onChange={(event) => setManifestDraft(event.target.value)}
                />
                <button
                  className="miniButton"
                  type="button"
                  disabled={disabled || !manifestDraft.trim()}
                  onClick={() => onManifestSave(manifestDraft)}
                >
                  <FolderOpen size={14} />
                  <span>Connect</span>
                </button>
              </div>
            </label>

            <label>
              <span>Optional post-composite label logo path</span>
              <div className="pathInputRow">
                <input
                  value={labelDraft}
                  disabled={disabled}
                  placeholder="/absolute/path/label-logo.png"
                  onChange={(event) => setLabelDraft(event.target.value)}
                />
                <button
                  className="miniButton"
                  type="button"
                  disabled={disabled || !labelDraft.trim()}
                  onClick={() => onLabelLogoSave(labelDraft)}
                >
                  <Sparkles size={14} />
                  <span>Set</span>
                </button>
              </div>
            </label>
          </div>

          <div className="labelLogoState">
            <span className={`statusPill status-${library?.labelLogoExists ? "accepted" : "used"}`}>
              {library?.labelLogoExists ? "post label saved" : "post label optional"}
            </span>
            <span>{library?.labelLogoPath ?? "No label-logo path configured"}</span>
            <button className="miniButton" type="button" disabled={disabled} onClick={onRescan}>
              <RefreshCw size={14} />
              <span>Rescan</span>
            </button>
          </div>

          {library?.errors.length ? (
            <div className="inlineAlert">
              {library.errors.map((error) => (
                <span key={error}>{error}</span>
              ))}
            </div>
          ) : null}
        </div>
      </details>

      {pickerOpen ? (
        <div className="modalOverlay" role="presentation">
          <section className="backgroundPickerModal" role="dialog" aria-modal="true" aria-label="Choose background">
            <div className="modalHeader">
              <div>
                <h2>Choose Background</h2>
                <p>
                  Showing {visibleBackgrounds.length} of {filteredBackgrounds.length}
                </p>
              </div>
              <div className="backgroundPickerHeaderActions">
                <button className="miniButton" type="button" onClick={shuffleBackgrounds}>
                  <Shuffle size={14} />
                  <span>Shuffle</span>
                </button>
                <button className="iconButton" type="button" aria-label="Close background picker" onClick={() => setPickerOpen(false)}>
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="backgroundFilters">
              {(["all", "new", "used", "living", "bedroom"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "isActive" : ""}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
              <input
                value={query}
                placeholder="Search"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="backgroundGrid">
              {visibleBackgrounds.map((background) => (
                <button
                  key={background.id}
                  type="button"
                  className={`backgroundCard ${selectedBackgroundId === background.id ? "isSelected" : ""}`}
                  onClick={() => {
                    onBackgroundChange(background.id);
                    setPickerOpen(false);
                  }}
                >
                  <span className="backgroundCardSpacer" aria-hidden="true" />
                  <div className="backgroundThumb">
                    {background.previewImagePath ? (
                      <img
                        className="backgroundThumbImage"
                        src={backgroundPreviewUrl(background.id, background.fingerprint)}
                        alt={`${background.title} preview`}
                        loading="lazy"
                      />
                    ) : (
                      <span>No preview</span>
                    )}
                  </div>
                  <div className="backgroundMetaOverlay">
                    <strong>{background.title}</strong>
                    <span>{background.type}</span>
                    <span className={`statusPill status-${background.status}`}>
                      {backgroundStatusLabel(background.status)}
                    </span>
                  </div>
                </button>
              ))}
              {visibleBackgrounds.length === 0 ? (
                <div className="backgroundEmptyState">No backgrounds match this filter.</div>
              ) : null}
              {remainingBackgroundCount > 0 ? (
                <button
                  className="controlButton backgroundLoadMore"
                  type="button"
                  onClick={() => setVisibleBackgroundCount((count) => count + BACKGROUND_PAGE_SIZE)}
                >
                  <ChevronDown size={15} />
                  <span>Show {Math.min(BACKGROUND_PAGE_SIZE, remainingBackgroundCount)} more</span>
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ReferenceSelector({
  product,
  selectedReferences,
  disabled,
  onReferencesChange
}: {
  product: ProductSummary | null;
  selectedReferences: string[];
  disabled: boolean;
  onReferencesChange: (referenceImages: string[]) => void;
}) {
  if (!product) {
    return null;
  }

  const available = product.referenceImages;
  if (available.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedReferences);

  const toggleReference = (filename: string) => {
    if (disabled) return;
    const next = selectedSet.has(filename)
      ? selectedReferences.filter((item) => item !== filename)
      : [...selectedReferences, filename].slice(0, 14);
    onReferencesChange(next);
  };

  return (
    <section className="referencePanel" aria-label="Reference images">
      <div className="sectionHeader compactReferenceHeader">
        <div>
          <h3>References</h3>
          <p>{selectedReferences.length}/{available.length} selected</p>
        </div>
      </div>

      <div className="referenceGrid">
        {available.map((filename) => {
          const selected = selectedSet.has(filename);
          return (
            <button
              key={filename}
              type="button"
              className={`referenceThumb ${selected ? "isSelected" : ""}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggleReference(filename)}
            >
              <img
                src={thumbnailUrl(product.id, "reference", filename)}
                alt={`${filename} reference`}
                loading="lazy"
              />
              <span>{filename}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface ShotRowProps {
  shot: Shot;
  index: number;
  requiresBackground: boolean;
  requiresLabel: boolean;
  hasLabelWorkflow: boolean;
  aggregate: ShotAggregateState;
  selected: boolean;
  disabled: boolean;
  onLoadShot: (shot: Shot) => void;
}

function ShotRow({
  shot,
  index,
  requiresBackground,
  requiresLabel,
  hasLabelWorkflow,
  aggregate,
  selected,
  disabled,
  onLoadShot
}: ShotRowProps) {
  const isGenerating = aggregate === "generating";

  return (
    <article
      className={`shotRow aggregate-${aggregate} ${selected ? "isSelected" : ""}`}
    >
      <button
        className="shotLoadSurface"
        type="button"
        disabled={disabled}
        aria-label={selected ? `${shot.name} prompt loaded` : `Load ${shot.name} prompt`}
        aria-pressed={selected}
        onClick={() => onLoadShot(shot)}
      >
        <span className="shotIndex">{String(index + 1).padStart(2, "0")}</span>
        <strong className="shotName">{shot.name}</strong>
        <span className="shotRequirementIcons" aria-label="Shot requirements">
          {requiresBackground ? <span className="requirementPill">BG</span> : null}
          {requiresLabel || hasLabelWorkflow ? <span className="requirementPill">Label</span> : null}
          <span className="requirementPill">Construction</span>
        </span>
        <span className={`aggregatePill aggregate-${aggregate}`}>
          {isGenerating ? <LoaderCircle className="spin" size={12} /> : null}
          {aggregateLabels[aggregate]}
        </span>
        <span className="shotActionLabel">{selected ? "Loaded" : "Load"}</span>
      </button>
    </article>
  );
}
