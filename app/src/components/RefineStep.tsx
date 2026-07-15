import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  FileImage,
  FileText,
  LoaderCircle,
  Maximize2,
  Palette,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type {
  AssetRecord,
  GeneratedResponse,
  ImageSize,
  JobRecord,
  ProductSummary,
  RefinePatternMode,
  RefineSettings,
  SosCustomPalette,
  SosPaletteId
} from "../../shared/types";
import {
  composeSosRefinePrompt,
  DEFAULT_SOS_CUSTOM_PALETTE,
  normalizeHexColor,
  SOS_PRESET_PALETTES
} from "../../shared/sos-palettes";
import { imageUrl, thumbnailUrl } from "../api";
import { formatDateTime, isRunningJob, sortNewestAssets } from "../utils";

const REFINE_SHOT_ID = "refine_base";
const REFINE_IMAGE_SIZES: ImageSize[] = ["1K", "2K", "4K"];
const REFINE_VARIATION_COUNTS = [1, 2, 3, 4];
const REFINE_PATTERN_MODES: Array<{ mode: RefinePatternMode; label: string }> = [
  { mode: "symmetrical", label: "Symmetrical" },
  { mode: "asymmetrical", label: "Asymmetrical" },
  { mode: "sos", label: "SOS" }
];
const REFINE_PATTERN_LABELS: Record<RefinePatternMode, string> = {
  symmetrical: "Symmetrical",
  asymmetrical: "Asymmetrical",
  sos: "SOS"
};

interface RefineStepProps {
  product: ProductSummary;
  generated: GeneratedResponse;
  jobs: JobRecord[];
  refineSettings: RefineSettings | null;
  imageSize: ImageSize;
  patternMode: RefinePatternMode;
  variationCount: number;
  sosPaletteId: SosPaletteId;
  sosCustomPalette: SosCustomPalette;
  sosDesignChange: boolean;
  busyAction: string | null;
  onUploadReference: (file: File) => void;
  onRefine: () => void;
  onImageSizeChange: (imageSize: ImageSize) => void;
  onPatternModeChange: (mode: RefinePatternMode) => void;
  onVariationCountChange: (count: number) => void;
  onSosPaletteChange: (paletteId: SosPaletteId) => void;
  onSosCustomPaletteChange: (palette: SosCustomPalette) => void;
  onSosDesignChange: (enabled: boolean) => void;
  onSaveRecentSosPalette: (palette: SosCustomPalette) => Promise<boolean>;
  onSavePrompt: (mode: RefinePatternMode, prompt: string) => Promise<boolean>;
  onValidate: (assetId: string) => void;
}

export function RefineStep({
  product,
  generated,
  jobs,
  refineSettings,
  imageSize,
  patternMode,
  variationCount,
  sosPaletteId,
  sosCustomPalette,
  sosDesignChange,
  busyAction,
  onUploadReference,
  onRefine,
  onImageSizeChange,
  onPatternModeChange,
  onVariationCountChange,
  onSosPaletteChange,
  onSosCustomPaletteChange,
  onSosDesignChange,
  onSaveRecentSosPalette,
  onSavePrompt,
  onValidate
}: RefineStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [mobileCompareView, setMobileCompareView] = useState<"reference" | "variation">("variation");
  const referenceImage = product.referenceImages.find((file) => file.startsWith("refine-reference.")) ?? null;
  const referenceSrc = referenceImage ? imageUrl(product.id, "reference", referenceImage) : null;
  const refineJobs = jobs.filter((job) => job.shotId === REFINE_SHOT_ID);
  const runningJobs = refineJobs.filter(isRunningJob);
  const refineAssets = useMemo(
    () =>
      sortNewestAssets(
        generated.active.filter(
          (asset) => asset.shotId === REFINE_SHOT_ID && asset.status !== "failed" && asset.output?.file
        )
      ).slice(0, variationCount),
    [generated.active, variationCount]
  );
  const failedCount = generated.active.filter(
    (asset) => asset.shotId === REFINE_SHOT_ID && asset.status === "failed"
  ).length;
  const selectedAsset =
    refineAssets.find((asset) => asset.assetId === selectedAssetId) ?? refineAssets[0] ?? null;
  const selectedIndex = selectedAsset
    ? refineAssets.findIndex((asset) => asset.assetId === selectedAsset.assetId)
    : -1;
  const hasReference = Boolean(referenceImage);
  const isBusy = Boolean(busyAction) || runningJobs.length > 0;
  const hasResults = refineAssets.length > 0 || runningJobs.length > 0 || failedCount > 0;
  const currentRefinePrompt = refineSettings
    ? patternMode === "sos"
      ? composeSosRefinePrompt({
          basePrompt: refineSettings.prompts.sos,
          paletteId: sosPaletteId,
          customPalette: sosCustomPalette,
          designChange: sosDesignChange
        })
      : refineSettings.prompts[patternMode]
    : null;
  const promptChangedSinceGeneration = Boolean(
    selectedAsset &&
      currentRefinePrompt &&
      selectedAsset.prompt.trim() !== currentRefinePrompt.trim()
  );

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onUploadReference(file);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleSelectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    setMobileCompareView("variation");
  };

  return (
    <main className="refineWorkspace">
      <section className="refineShell" aria-label="Refine missing base image">
        <div className="refineHeader">
          <div className="refineTitleGroup">
            <span className="refineIcon" aria-hidden="true">
              <Sparkles size={20} />
            </span>
            <div>
              <h1>Refine step</h1>
              <p>{product.name} needs a base.png before the normal workflow opens.</p>
            </div>
          </div>
          <div className="refineHeaderActions">
            <button
              className="miniButton"
              type="button"
              disabled={!refineSettings}
              onClick={() => setPromptOpen(true)}
            >
              <FileText size={14} />
              <span>Prompt</span>
            </button>
            <details className="refineDetails">
              <summary>
                Details
                <ChevronDown size={14} />
              </summary>
              <div>
                <span>Nano Banana Pro edit</span>
                <span>{imageSize}</span>
                <span>1:1</span>
                <span>
                  {variationCount} {variationCount === 1 ? "variation" : "variations"}
                </span>
                <span>{REFINE_PATTERN_LABELS[patternMode]}</span>
              </div>
            </details>
          </div>
        </div>

        <input
          ref={inputRef}
          className="visuallyHidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => handleFiles(event.target.files)}
        />

        {!hasReference ? (
          <button
            className={`refineDropzone ${isDragging ? "isDragging" : ""}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload size={26} />
            <strong>Drop a reference rug image</strong>
            <span>PNG, JPG, or WEBP</span>
          </button>
        ) : (
          <div className={`refineStart ${patternMode === "sos" ? "hasSosControls" : ""}`}>
            <div className="refineReference">
              <div className="refineReferenceThumb">
                <img src={thumbnailUrl(product.id, "reference", referenceImage as string)} alt="" />
              </div>
              <div>
                <strong>Reference ready</strong>
                <span>{referenceImage}</span>
              </div>
              <button className="miniButton" type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}>
                Replace
              </button>
            </div>

            <div className="refineStartActions">
              <div className="refinePatternSwitch" role="group" aria-label="Reference pattern type">
                {REFINE_PATTERN_MODES.map(({ mode, label }) => (
                  <button
                    className={mode === patternMode ? "isActive" : ""}
                    type="button"
                    aria-pressed={mode === patternMode}
                    disabled={isBusy}
                    onClick={() => onPatternModeChange(mode)}
                    key={mode}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="refineSizeSwitch" role="group" aria-label="Refine image size">
                {REFINE_IMAGE_SIZES.map((size) => (
                  <button
                    className={size === imageSize ? "isActive" : ""}
                    type="button"
                    aria-pressed={size === imageSize}
                    disabled={isBusy}
                    onClick={() => onImageSizeChange(size)}
                    key={size}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <div className="refineVariationCountSwitch" role="group" aria-label="Refine variation count">
                {REFINE_VARIATION_COUNTS.map((count) => (
                  <button
                    className={count === variationCount ? "isActive" : ""}
                    type="button"
                    aria-label={`Generate ${count} ${count === 1 ? "variation" : "variations"}`}
                    aria-pressed={count === variationCount}
                    title={`Generate ${count} ${count === 1 ? "variation" : "variations"}`}
                    disabled={isBusy}
                    onClick={() => onVariationCountChange(count)}
                    key={count}
                  >
                    {count}x
                  </button>
                ))}
              </div>
              <button className="controlButton primary refinePrimary" type="button" onClick={onRefine} disabled={isBusy}>
                {isBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                <span>{hasResults ? "Retry refine" : "Refine"}</span>
              </button>
            </div>
            {patternMode === "sos" ? (
              <SosPalettePanel
                paletteId={sosPaletteId}
                customPalette={sosCustomPalette}
                recentPalettes={refineSettings?.recentSosPalettes ?? []}
                designChange={sosDesignChange}
                disabled={isBusy}
                saving={busyAction === "save-sos-palette"}
                onPaletteChange={onSosPaletteChange}
                onCustomPaletteChange={onSosCustomPaletteChange}
                onDesignChange={onSosDesignChange}
                onSaveRecentPalette={onSaveRecentSosPalette}
              />
            ) : null}
          </div>
        )}

        {hasResults && referenceSrc ? (
          <section className="refineResults" aria-label="Refined variations">
            <div className="refineResultsHeader">
              <div>
                <h2>Compare and choose</h2>
                <p>
                  {runningJobs.length > 0
                    ? `${runningJobs.length} refining. You can keep reviewing completed variations.`
                    : "Compare the reference with a variation, then choose the new base."}
                </p>
              </div>
              {failedCount > 0 ? (
                <span className="refineWarning">
                  <AlertTriangle size={14} />
                  {failedCount} failed
                </span>
              ) : null}
            </div>

            <div className="refineMobileCompareSwitch" role="tablist" aria-label="Comparison image">
              <button
                type="button"
                role="tab"
                aria-selected={mobileCompareView === "reference"}
                className={mobileCompareView === "reference" ? "isActive" : ""}
                onClick={() => setMobileCompareView("reference")}
              >
                Original
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobileCompareView === "variation"}
                className={mobileCompareView === "variation" ? "isActive" : ""}
                onClick={() => setMobileCompareView("variation")}
              >
                Variation {selectedIndex >= 0 ? selectedIndex + 1 : ""}
              </button>
            </div>

            <div className="refineCompareStage">
              <CompareImage
                className={mobileCompareView === "reference" ? "isMobileActive" : ""}
                label="Original reference"
                src={referenceSrc}
                alt={`${product.name} original reference`}
                onInspect={() => selectedAsset && setInspectOpen(true)}
                inspectDisabled={!selectedAsset}
              />
              {selectedAsset?.output?.file ? (
                <CompareImage
                  className={mobileCompareView === "variation" ? "isMobileActive" : ""}
                  label={`Variation ${selectedIndex + 1}`}
                  src={imageUrl(product.id, "generated", selectedAsset.output.file)}
                  alt={`${product.name} refined variation ${selectedIndex + 1}`}
                  note={promptChangedSinceGeneration ? "Generated with a different refine setup" : undefined}
                  onInspect={() => setInspectOpen(true)}
                />
              ) : (
                <figure className={`refineComparePane ${mobileCompareView === "variation" ? "isMobileActive" : ""}`}>
                  <figcaption>Selected variation</figcaption>
                  <div className="refineComparePending">
                    {runningJobs.length > 0 ? <LoaderCircle className="spin" size={24} /> : <FileImage size={24} />}
                    <strong>{runningJobs.length > 0 ? "Refining" : "No completed variation"}</strong>
                  </div>
                </figure>
              )}
            </div>

            <div className="refineVariationPicker" role="radiogroup" aria-label="Choose a refined variation">
              {refineAssets.map((asset, index) => (
                <VariationChoice
                  asset={asset}
                  index={index}
                  productId={product.id}
                  selected={asset.assetId === selectedAsset?.assetId}
                  onSelect={handleSelectAsset}
                  key={asset.assetId}
                />
              ))}
              {Array.from({ length: Math.max(0, variationCount - refineAssets.length) }).map((_, index) => (
                <div className="refineVariationChoice isPending" key={`pending-${index}`}>
                  <span className="refineVariationChoiceImage">
                    {runningJobs.length > 0 ? <LoaderCircle className="spin" size={18} /> : <FileImage size={18} />}
                  </span>
                  <span>{runningJobs.length > 0 ? "Refining" : "Waiting"}</span>
                </div>
              ))}
            </div>

            {selectedAsset ? (
              <div className="refineActions">
                <button
                  className="controlButton primary"
                  type="button"
                  onClick={() => onValidate(selectedAsset.assetId)}
                  disabled={Boolean(busyAction)}
                >
                  <Check size={16} />
                  <span>Use variation {selectedIndex + 1} as base.png</span>
                </button>
                <button className="controlButton" type="button" onClick={onRefine} disabled={isBusy}>
                  <RefreshCw size={15} />
                  <span>Retry</span>
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>

      {promptOpen && refineSettings ? (
        <RefinePromptModal
          settings={refineSettings}
          mode={patternMode}
          saving={busyAction === "save-refine-prompt"}
          onClose={() => setPromptOpen(false)}
          onSave={onSavePrompt}
        />
      ) : null}

      {inspectOpen && referenceSrc && selectedAsset?.output?.file ? (
        <RefineInspectModal
          referenceSrc={referenceSrc}
          variationSrc={imageUrl(product.id, "generated", selectedAsset.output.file)}
          variationLabel={`Variation ${selectedIndex + 1}`}
          onClose={() => setInspectOpen(false)}
        />
      ) : null}
    </main>
  );
}

function SosPalettePanel({
  paletteId,
  customPalette,
  recentPalettes,
  designChange,
  disabled,
  saving,
  onPaletteChange,
  onCustomPaletteChange,
  onDesignChange,
  onSaveRecentPalette
}: {
  paletteId: SosPaletteId;
  customPalette: SosCustomPalette;
  recentPalettes: SosCustomPalette[];
  designChange: boolean;
  disabled: boolean;
  saving: boolean;
  onPaletteChange: (paletteId: SosPaletteId) => void;
  onCustomPaletteChange: (palette: SosCustomPalette) => void;
  onDesignChange: (enabled: boolean) => void;
  onSaveRecentPalette: (palette: SosCustomPalette) => Promise<boolean>;
}) {
  const [customOpen, setCustomOpen] = useState(paletteId === "custom");
  const [draftField, setDraftField] = useState(customPalette.fieldColor);
  const [draftMotif, setDraftMotif] = useState(customPalette.motifColor);
  const [applying, setApplying] = useState(false);
  const normalizedField = normalizeHexColor(draftField);
  const normalizedMotif = normalizeHexColor(draftMotif);
  const customValid = Boolean(
    normalizedField && normalizedMotif && normalizedField !== normalizedMotif
  );

  useEffect(() => {
    setDraftField(customPalette.fieldColor);
    setDraftMotif(customPalette.motifColor);
    if (paletteId === "custom") {
      setCustomOpen(true);
    }
  }, [customPalette.fieldColor, customPalette.motifColor, paletteId]);

  const applyCustomPalette = async () => {
    if (!normalizedField || !normalizedMotif || normalizedField === normalizedMotif) return;
    const palette = { fieldColor: normalizedField, motifColor: normalizedMotif };
    setApplying(true);
    onCustomPaletteChange(palette);
    const saved = await onSaveRecentPalette(palette);
    setApplying(false);
    if (saved) {
      setCustomOpen(false);
    }
  };

  return (
    <section className="sosPalettePanel" aria-label="SOS color direction">
      <div className="sosPaletteHeader">
        <div>
          <strong>Color direction</strong>
          <span>{designChange ? "Minor design tweaks allowed" : "Exact design · colors only"}</span>
        </div>
        <label className="sosDesignToggle">
          <span className="sosDesignToggleCopy">
            <strong>Design change</strong>
            <span>{designChange ? "On" : "Off"}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={designChange}
            disabled={disabled}
            onChange={(event) => onDesignChange(event.target.checked)}
          />
          <span className="sosDesignToggleTrack" aria-hidden="true">
            <span />
          </span>
        </label>
      </div>

      <div className="sosPaletteScroller" role="radiogroup" aria-label="Choose SOS colors">
        {SOS_PRESET_PALETTES.map((palette) => (
          <button
            className={`sosPaletteOption ${paletteId === palette.id ? "isSelected" : ""}`}
            type="button"
            role="radio"
            aria-checked={paletteId === palette.id}
            aria-label={
              palette.id === "auto_flip"
                ? "Auto flip the original colors"
                : `${palette.label}, field ${palette.fieldColor}, motif ${palette.motifColor}`
            }
            disabled={disabled}
            onClick={() => {
              onPaletteChange(palette.id);
              setCustomOpen(false);
            }}
            key={palette.id}
          >
            {palette.id === "auto_flip" ? (
              <span className="sosAutoPalette" aria-hidden="true">
                <ArrowLeftRight size={17} />
              </span>
            ) : (
              <PaletteSwatches fieldColor={palette.fieldColor as string} motifColor={palette.motifColor as string} />
            )}
            <span>{palette.label}</span>
            {paletteId === palette.id ? <Check size={13} aria-hidden="true" /> : null}
          </button>
        ))}

        <button
          className={`sosPaletteOption ${paletteId === "custom" ? "isSelected" : ""}`}
          type="button"
          role="radio"
          aria-checked={paletteId === "custom"}
          aria-expanded={customOpen}
          disabled={disabled}
          onClick={() => setCustomOpen((open) => !open)}
        >
          <PaletteSwatches fieldColor={customPalette.fieldColor} motifColor={customPalette.motifColor} />
          <span>Custom</span>
          <Palette size={13} aria-hidden="true" />
        </button>
      </div>

      {customOpen ? (
        <form
          className="sosCustomPaletteEditor"
          onSubmit={(event) => {
            event.preventDefault();
            void applyCustomPalette();
          }}
        >
          <div className="sosCustomPaletteFields">
            <SosColorField
              label="Field"
              value={draftField}
              fallback={DEFAULT_SOS_CUSTOM_PALETTE.fieldColor}
              disabled={disabled || applying}
              onChange={setDraftField}
            />
            <button
              className="sosSwapColors"
              type="button"
              aria-label="Swap field and motif colors"
              title="Swap field and motif colors"
              disabled={disabled || applying}
              onClick={() => {
                setDraftField(draftMotif);
                setDraftMotif(draftField);
              }}
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
            </button>
            <SosColorField
              label="Motif"
              value={draftMotif}
              fallback={DEFAULT_SOS_CUSTOM_PALETTE.motifColor}
              disabled={disabled || applying}
              onChange={setDraftMotif}
            />
          </div>

          {recentPalettes.length > 0 ? (
            <div className="sosRecentPalettes">
              <span>Recent</span>
              <div>
                {recentPalettes.map((palette) => (
                  <button
                    type="button"
                    aria-label={`Use recent colors ${palette.fieldColor} and ${palette.motifColor}`}
                    title={`${palette.fieldColor} / ${palette.motifColor}`}
                    disabled={disabled || applying}
                    onClick={() => {
                      setDraftField(palette.fieldColor);
                      setDraftMotif(palette.motifColor);
                    }}
                    key={`${palette.fieldColor}:${palette.motifColor}`}
                  >
                    <PaletteSwatches fieldColor={palette.fieldColor} motifColor={palette.motifColor} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!customValid ? <span className="sosCustomPaletteError">Choose two different six-digit hex colors.</span> : null}
          <div className="sosCustomPaletteActions">
            <button
              className="controlButton"
              type="button"
              disabled={disabled || applying}
              onClick={() => setCustomOpen(false)}
            >
              Cancel
            </button>
            <button
              className="controlButton primary"
              type="submit"
              disabled={disabled || saving || applying || !customValid}
            >
              {saving || applying ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              <span>Use colors</span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function SosColorField({
  label,
  value,
  fallback,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const normalized = normalizeHexColor(value);

  return (
    <label className="sosColorField">
      <span>{label}</span>
      <input
        className="sosNativeColor"
        type="color"
        value={normalized ?? fallback}
        disabled={disabled}
        aria-label={`${label} color picker`}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <input
        className="sosHexInput"
        value={value}
        maxLength={7}
        spellCheck={false}
        disabled={disabled}
        aria-label={`${label} color hex`}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
    </label>
  );
}

function PaletteSwatches({ fieldColor, motifColor }: SosCustomPalette) {
  return (
    <span className="sosPaletteSwatches" aria-hidden="true">
      <span style={{ backgroundColor: fieldColor }} />
      <span style={{ backgroundColor: motifColor }} />
    </span>
  );
}

function CompareImage({
  className = "",
  label,
  src,
  alt,
  note,
  inspectDisabled = false,
  onInspect
}: {
  className?: string;
  label: string;
  src: string;
  alt: string;
  note?: string;
  inspectDisabled?: boolean;
  onInspect: () => void;
}) {
  return (
    <figure className={`refineComparePane ${className}`}>
      <figcaption>
        <span>{label}</span>
        {note ? <span className="refinePromptMismatch">{note}</span> : null}
      </figcaption>
      <button
        className="refineCompareImage"
        type="button"
        disabled={inspectDisabled}
        aria-label={`Inspect ${label}`}
        onClick={onInspect}
      >
        <img src={src} alt={alt} />
        {!inspectDisabled ? (
          <span className="refineInspectHint" aria-hidden="true">
            <Maximize2 size={15} />
          </span>
        ) : null}
      </button>
    </figure>
  );
}

function VariationChoice({
  asset,
  index,
  productId,
  selected,
  onSelect
}: {
  asset: AssetRecord;
  index: number;
  productId: string;
  selected: boolean;
  onSelect: (assetId: string) => void;
}) {
  if (!asset.output?.file) return null;

  return (
    <button
      className={`refineVariationChoice ${selected ? "isSelected" : ""}`}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(asset.assetId)}
    >
      <span className="refineVariationChoiceImage">
        <img src={thumbnailUrl(productId, "generated", asset.output.file)} alt="" />
      </span>
      <span>Variation {index + 1}</span>
      {selected ? <Check size={14} /> : null}
    </button>
  );
}

function RefinePromptModal({
  settings,
  mode,
  saving,
  onClose,
  onSave
}: {
  settings: RefineSettings;
  mode: RefinePatternMode;
  saving: boolean;
  onClose: () => void;
  onSave: (mode: RefinePatternMode, prompt: string) => Promise<boolean>;
}) {
  const prompt = settings.prompts[mode];
  const defaultPrompt = settings.defaultPrompts[mode];
  const modeLabel = REFINE_PATTERN_LABELS[mode];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt);
  const trimmedDraft = draft.trim();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const handleSave = async () => {
    if (!trimmedDraft || trimmedDraft === prompt) return;
    if (await onSave(mode, trimmedDraft)) {
      onClose();
    }
  };

  return (
    <div className="modalOverlay" role="presentation">
      <section className="refinePromptModal" role="dialog" aria-modal="true" aria-labelledby="refine-prompt-title">
        <div className="modalHeader">
          <div>
            <h2 id="refine-prompt-title">{modeLabel} refine prompt</h2>
            <p>Global default for {modeLabel.toLowerCase()} rugs. Last saved {formatDateTime(settings.updatedAt)}.</p>
          </div>
          <button className="iconButton" type="button" aria-label="Close prompt" onClick={onClose} disabled={saving}>
            <X size={16} />
          </button>
        </div>

        {editing ? (
          <textarea
            className="refinePromptTextarea"
            aria-label="Refine prompt text"
            value={draft}
            autoFocus
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <div className="refinePromptReadOnly">{prompt}</div>
        )}

        <div className="refinePromptActions">
          {editing ? (
            <>
              <button
                className="controlButton"
                type="button"
                disabled={saving || draft === defaultPrompt}
                onClick={() => setDraft(defaultPrompt)}
              >
                <RotateCcw size={15} />
                <span>Reset to original</span>
              </button>
              <span className="refinePromptActionSpacer" />
              <button
                className="controlButton"
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraft(prompt);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                className="controlButton primary"
                type="button"
                disabled={saving || !trimmedDraft || trimmedDraft === prompt}
                onClick={() => void handleSave()}
              >
                {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                <span>Save as default</span>
              </button>
            </>
          ) : (
            <>
              <span className="refinePromptActionSpacer" />
              <button className="controlButton" type="button" onClick={onClose}>
                Close
              </button>
              <button className="controlButton primary" type="button" onClick={() => setEditing(true)}>
                <Pencil size={15} />
                <span>Edit</span>
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function RefineInspectModal({
  referenceSrc,
  variationSrc,
  variationLabel,
  onClose
}: {
  referenceSrc: string;
  variationSrc: string;
  variationLabel: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mobileView, setMobileView] = useState<"reference" | "variation">("variation");
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const changeZoom = useCallback((nextZoom: number) => {
    const normalized = Math.min(4, Math.max(1, Number(nextZoom.toFixed(2))));
    setZoom(normalized);
    if (normalized === 1) setPan({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const imageStyle = {
    "--refine-inspect-zoom": zoom,
    "--refine-inspect-x": `${pan.x}px`,
    "--refine-inspect-y": `${pan.y}px`
  } as CSSProperties;

  return (
    <div className="modalOverlay refineInspectOverlay" role="presentation">
      <section className="refineInspectModal" role="dialog" aria-modal="true" aria-labelledby="refine-inspect-title">
        <div className="refineInspectHeader">
          <div>
            <h2 id="refine-inspect-title">Inspect comparison</h2>
            <p>Zoom and drag either image. Both views stay synchronized.</p>
          </div>
          <div className="refineInspectTools">
            <button className="iconButton" type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => changeZoom(zoom - 0.5)}>
              <ZoomOut size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="iconButton" type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => changeZoom(zoom + 0.5)}>
              <ZoomIn size={16} />
            </button>
            <button
              className="iconButton"
              type="button"
              aria-label="Reset zoom and position"
              disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <RotateCcw size={15} />
            </button>
            <button className="iconButton" type="button" aria-label="Close comparison" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="refineInspectMobileSwitch" role="tablist" aria-label="Inspect image">
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === "reference"}
            className={mobileView === "reference" ? "isActive" : ""}
            onClick={() => setMobileView("reference")}
          >
            Original
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === "variation"}
            className={mobileView === "variation" ? "isActive" : ""}
            onClick={() => setMobileView("variation")}
          >
            {variationLabel}
          </button>
        </div>

        <div className="refineInspectGrid">
          <InspectImage
            active={mobileView === "reference"}
            label="Original reference"
            src={referenceSrc}
            style={imageStyle}
            zoomed={zoom > 1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerEnd={handlePointerEnd}
          />
          <InspectImage
            active={mobileView === "variation"}
            label={variationLabel}
            src={variationSrc}
            style={imageStyle}
            zoomed={zoom > 1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerEnd={handlePointerEnd}
          />
        </div>
      </section>
    </div>
  );
}

function InspectImage({
  active,
  label,
  src,
  style,
  zoomed,
  onPointerDown,
  onPointerMove,
  onPointerEnd
}: {
  active: boolean;
  label: string;
  src: string;
  style: CSSProperties;
  zoomed: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <figure className={`refineInspectPane ${active ? "isMobileActive" : ""}`}>
      <figcaption>{label}</figcaption>
      <div
        className={`refineInspectCanvas ${zoomed ? "isZoomed" : ""}`}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <img src={src} alt={label} draggable={false} />
      </div>
    </figure>
  );
}
