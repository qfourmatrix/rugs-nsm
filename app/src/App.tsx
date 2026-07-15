import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  acceptAsset,
  cancelJob,
  createProduct,
  generateFromPromptBox,
  generateMissing,
  getAppInfo,
  getBackgroundLibrary,
  getGenerated,
  getJobs,
  getMasterShots,
  getProducts,
  getProductState,
  getRefineSettings,
  rejectAsset,
  retryAsset,
  retryFailed,
  saveRecentSosPalette,
  startRefine,
  rescanBackgroundLibrary,
  updateBackgroundManifest,
  updateLabelLogoPath,
  updateMasterShots,
  updateProductBackground,
  updateProductState,
  updateRefineSettings,
  uploadRefineReference,
  validateRefineVariation
} from "./api";
import { LeftPanel } from "./components/LeftPanel";
import { ProductTabs } from "./components/ProductTabs";
import { RefineStep } from "./components/RefineStep";
import { RightPanel } from "./components/RightPanel";
import type {
  GeneratedResponse,
  AppInfo,
  BackgroundLibraryState,
  ImageSize,
  JobRecord,
  MasterShots,
  ProductState,
  ProductSummary,
  RefinePatternMode,
  RefineSettings,
  RugConstructionId,
  SosCustomPalette,
  SosPaletteId,
  Shot
} from "../shared/types";
import { DEFAULT_SOS_CUSTOM_PALETTE } from "../shared/sos-palettes";
import type { AppMode } from "./types";
import { getErrorMessage, isRunningJob, pluralize, toLocatedAssets } from "./utils";

const emptyGenerated: GeneratedResponse = {
  active: [],
  trash: [],
  aggregates: {}
};

const PANEL_WIDTH_STORAGE_KEY = "product-shot-queue:left-panel-width";
const DEFAULT_LEFT_PANEL_WIDTH = 520;
const MIN_LEFT_PANEL_WIDTH = 340;
const MIN_RIGHT_PANEL_WIDTH = 500;
const REFINE_SHOT_ID = "refine_base";

type ConfirmationRequest = {
  title: string;
  message: string;
  details: { label: string; value: string }[];
  confirmLabel: string;
  cancelLabel: string;
  resolve: (confirmed: boolean) => void;
};

export function App() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [masterShots, setMasterShots] = useState<MasterShots | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productState, setProductState] = useState<ProductState | null>(null);
  const [generated, setGenerated] = useState<GeneratedResponse>(emptyGenerated);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [refineSettings, setRefineSettings] = useState<RefineSettings | null>(null);
  const [backgroundLibrary, setBackgroundLibrary] = useState<BackgroundLibraryState | null>(null);
  const [mode, setMode] = useState<AppMode>("generate");
  const [search, setSearch] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [savingState, setSavingState] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_LEFT_PANEL_WIDTH;
    return clampPanelWidth(Number.isFinite(parsed) ? parsed : DEFAULT_LEFT_PANEL_WIDTH);
  });

  const selectedProductRef = useRef<string | null>(null);
  const productStateRef = useRef<ProductState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ productId: string; state: ProductState } | null>(null);
  const saveSequenceRef = useRef(0);
  const shellLoadSequenceRef = useRef(0);
  const productLoadSequenceRef = useRef(0);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const selectedProductJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.productId === selectedProductId &&
          (selectedProduct?.status === "missing_base" || job.shotId !== REFINE_SHOT_ID)
      ),
    [jobs, selectedProduct?.status, selectedProductId]
  );

  const runningShotIds = useMemo(
    () =>
      new Set(
        selectedProductJobs
          .filter(isRunningJob)
          .map((job) => job.shotId)
      ),
    [selectedProductJobs]
  );

  const allAssets = useMemo(
    () => toLocatedAssets(generated.active, generated.trash),
    [generated.active, generated.trash]
  );

  const selectedAsset = useMemo(() => {
    const selectedAssetId = productState?.selectedAssetId;
    return allAssets.find((asset) => asset.assetId === selectedAssetId) ?? null;
  }, [allAssets, productState?.selectedAssetId]);

  useEffect(() => {
    selectedProductRef.current = selectedProductId;
  }, [selectedProductId]);

  useEffect(() => {
    productStateRef.current = productState;
  }, [productState]);

  const loadShell = useCallback(async (silent = false) => {
    const sequence = ++shellLoadSequenceRef.current;
    const refineSettingsRequest = Promise.allSettled([getRefineSettings()]);
    if (!silent) {
      setIsLoadingShell(true);
    }
    setShellError(null);

    try {
      setAppInfo(await getAppInfo());
    } catch {
      setAppInfo(null);
    }

    try {
      const nextProducts = await getProducts();
      setProducts(nextProducts);
      setSelectedProductId((current) => {
        if (current && nextProducts.some((product) => product.id === current)) {
          return current;
        }

        return nextProducts[0]?.id ?? null;
      });
    } catch (error) {
      setShellError(getErrorMessage(error));
      setProducts([]);
      setSelectedProductId(null);
    }

    try {
      setMasterShots(await getMasterShots());
    } catch (error) {
      setMasterShots(null);
      setShellError((current) => current ?? getErrorMessage(error));
    }

    try {
      setJobs(await getJobs());
    } catch {
      setJobs([]);
    }

    try {
      setBackgroundLibrary(await getBackgroundLibrary());
    } catch (error) {
      setBackgroundLibrary(null);
      setShellError((current) => current ?? getErrorMessage(error));
    }

    const [refineSettingsResult] = await refineSettingsRequest;
    if (refineSettingsResult.status === "fulfilled") {
      setRefineSettings(refineSettingsResult.value);
    } else {
      setRefineSettings(null);
      setShellError((current) => current ?? getErrorMessage(refineSettingsResult.reason));
    }

    if (sequence === shellLoadSequenceRef.current) {
      setIsLoadingShell(false);
    }
  }, []);

  const loadSelectedProduct = useCallback(async (productId: string, silent = false) => {
    const sequence = ++productLoadSequenceRef.current;
    if (!silent) {
      setIsLoadingProduct(true);
    }
    setSelectedError(null);

    try {
      const [stateResult, generatedResult, jobsResult] = await Promise.allSettled([
        getProductState(productId),
        getGenerated(productId),
        getJobs()
      ]);

      if (sequence !== productLoadSequenceRef.current || selectedProductRef.current !== productId) {
        return;
      }

      if (stateResult.status === "fulfilled") {
        setProductState(stateResult.value);
        productStateRef.current = stateResult.value;
      } else {
        setProductState(null);
        productStateRef.current = null;
        setSelectedError(getErrorMessage(stateResult.reason));
      }

      if (generatedResult.status === "fulfilled") {
        setGenerated(generatedResult.value);
      } else {
        setGenerated(emptyGenerated);
        setSelectedError((current) => current ?? getErrorMessage(generatedResult.reason));
      }

      if (jobsResult.status === "fulfilled") {
        setJobs(jobsResult.value);
      }
    } finally {
      if (sequence === productLoadSequenceRef.current) {
        setIsLoadingProduct(false);
      }
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    const productId = selectedProductRef.current;

    await loadShell(true);

    if (productId) {
      await loadSelectedProduct(productId, true);
    }
  }, [loadSelectedProduct, loadShell]);

  const refreshQueueState = useCallback(async () => {
    const productId = selectedProductRef.current;
    const [jobsResult, generatedResult, backgroundLibraryResult] = await Promise.allSettled([
      getJobs(),
      productId ? getGenerated(productId) : Promise.resolve(null),
      getBackgroundLibrary()
    ]);

    if (jobsResult.status === "fulfilled") {
      setJobs(jobsResult.value);
    }

    if (
      productId &&
      selectedProductRef.current === productId &&
      generatedResult.status === "fulfilled" &&
      generatedResult.value
    ) {
      setGenerated(generatedResult.value);
    }

    if (backgroundLibraryResult.status === "fulfilled") {
      setBackgroundLibrary(backgroundLibraryResult.value);
    }
  }, []);

  const persistProductState = useCallback(async (productId: string, nextState: ProductState) => {
    const sequence = ++saveSequenceRef.current;
    setSavingState(true);

    try {
      const saved = await updateProductState(productId, nextState);

      if (selectedProductRef.current === productId && sequence === saveSequenceRef.current) {
        setProductState(saved);
        productStateRef.current = saved;
      }
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      if (sequence === saveSequenceRef.current) {
        setSavingState(false);
      }
    }
  }, []);

  const runPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;

    if (pending) {
      void persistProductState(pending.productId, pending.state);
    }
  }, [persistProductState]);

  const scheduleProductStateSave = useCallback(
    (nextState: ProductState, immediate = false) => {
      const productId = selectedProductRef.current;

      if (!productId) {
        return;
      }

      setProductState(nextState);
      productStateRef.current = nextState;
      pendingSaveRef.current = { productId, state: nextState };

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }

      if (immediate) {
        runPendingSave();
      } else {
        saveTimerRef.current = window.setTimeout(runPendingSave, 450);
      }
    },
    [runPendingSave]
  );

  const updateStateDraft = useCallback(
    (recipe: (current: ProductState) => ProductState, immediate = false) => {
      const current = productStateRef.current;

      if (!current) {
        return;
      }

      scheduleProductStateSave(recipe(current), immediate);
    },
    [scheduleProductStateSave]
  );

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    if (selectedProductId) {
      void loadSelectedProduct(selectedProductId);
    } else {
      setProductState(null);
      setGenerated(emptyGenerated);
    }
  }, [loadSelectedProduct, selectedProductId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasRunningJobs =
      selectedProductJobs.some(isRunningJob) || products.some((product) => product.counts.running > 0);

    if (!hasRunningJobs) {
      return undefined;
    }

    const queueInterval = window.setInterval(() => {
      void refreshQueueState();
    }, 2500);
    const shellInterval = window.setInterval(() => {
      void loadShell(true);
    }, 12000);

    return () => {
      window.clearInterval(queueInterval);
      window.clearInterval(shellInterval);
    };
  }, [loadShell, products, refreshQueueState, selectedProductJobs]);

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(leftPanelWidth));
  }, [leftPanelWidth]);

  const handleSelectProduct = useCallback(
    (productId: string) => {
      runPendingSave();
      setSelectedProductId(productId);
      setMode("generate");
      setActionError(null);
    },
    [runPendingSave]
  );

  const handleRescan = useCallback(() => {
    runPendingSave();
    void refreshCurrent();
  }, [refreshCurrent, runPendingSave]);

  const handlePromptChange = useCallback(
    (value: string) => {
      updateStateDraft((current) => ({
        ...current,
        promptBox: {
          ...current.promptBox,
          value,
          dirty: true,
          updatedAt: new Date().toISOString()
        }
      }));
    },
    [updateStateDraft]
  );

  const handleSettingsChange = useCallback(
    (settings: Partial<ProductState["settings"]>) => {
      updateStateDraft((current) => ({
        ...current,
        settings: {
          ...current.settings,
          ...settings
        }
      }));
    },
    [updateStateDraft]
  );

  const handleReferencesChange = useCallback(
    (referenceImages: string[]) => {
      updateStateDraft((current) => ({
        ...current,
        referenceImages
      }));
    },
    [updateStateDraft]
  );

  const handleLoadShot = useCallback(
    (shot: Shot) => {
      const current = productStateRef.current;
      if (
        current?.promptBox.dirty &&
        current.selectedShotId !== shot.id &&
        current.promptBox.value.trim() &&
        current.promptBox.value !== shot.prompt &&
        !window.confirm(
          `Replace your edited prompt with the ${shot.name} template?\n\nYour current product draft will be overwritten.`
        )
      ) {
        return;
      }

      updateStateDraft(
        (current) => ({
          ...current,
          selectedShotId: shot.id,
          promptBox: {
            value: shot.prompt,
            sourceShotId: shot.id,
            dirty: false,
            updatedAt: new Date().toISOString()
          }
        }),
        true
      );
    },
    [updateStateDraft]
  );

  const handleSelectAsset = useCallback(
    (assetId: string) => {
      updateStateDraft(
        (current) => ({
          ...current,
          selectedAssetId: assetId
        }),
        true
      );
      setMode("compare");
    },
    [updateStateDraft]
  );

  const runMutation = useCallback(
    async (label: string, action: () => Promise<unknown>, refresh: "full" | "queue" = "full") => {
      runPendingSave();
      setBusyAction(label);
      setActionError(null);

      try {
        await action();
        if (refresh === "queue") {
          await refreshQueueState();
          void loadShell(true);
        } else {
          await refreshCurrent();
        }
      } catch (error) {
        setActionError(getErrorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [loadShell, refreshCurrent, refreshQueueState, runPendingSave]
  );

  const requestConfirmation = useCallback(
    (request: Omit<ConfirmationRequest, "resolve">) =>
      new Promise<boolean>((resolve) => {
        setConfirmation({ ...request, resolve });
      }),
    []
  );

  const closeConfirmation = useCallback((confirmed: boolean) => {
    setConfirmation((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const currentGenerateSettings = useCallback(() => {
    const settings = productStateRef.current?.settings;

    return {
      aspectRatio: settings?.aspectRatio ?? "1:1",
      imageSize: settings?.imageSize ?? "4K"
    } as const;
  }, []);

  const currentBatchSize = useCallback(() => {
    return productStateRef.current?.settings.batchSize ?? 1;
  }, []);

  const confirmBulkAction = useCallback(
    async (verb: string, shotCount: number, imageCount = shotCount) => {
      const product = products.find((item) => item.id === selectedProductRef.current);
      const settings = currentGenerateSettings();
      const batchSize = currentBatchSize();
      const referenceCount = productStateRef.current?.referenceImages.length ?? 0;

      if (imageCount <= 1) {
        return true;
      }

      const scope =
        imageCount === shotCount
          ? pluralize(imageCount, "image")
          : `${pluralize(imageCount, "image")} (${pluralize(shotCount, "shot")} x batch ${batchSize})`;

      return requestConfirmation({
        title: `${verb} ${scope}`,
        message: "This will be sent to the backend queue.",
        details: [
          { label: "Product", value: product?.name ?? "Current product" },
          { label: "Provider", value: "Backend queue" },
          { label: "Aspect ratio", value: settings.aspectRatio },
          { label: "Image size", value: settings.imageSize },
          { label: "References", value: String(referenceCount) }
        ],
        confirmLabel: verb,
        cancelLabel: "Cancel"
      });
    },
    [currentBatchSize, currentGenerateSettings, products, requestConfirmation]
  );

  const handleGeneratePrompt = useCallback(
    async (shotId: string) => {
      const productId = selectedProductRef.current;
      const state = productStateRef.current;

      if (!productId || !state) {
        return;
      }

      if (state.selectedShotId !== shotId) {
        setActionError("Load this shot before generating from the prompt box.");
        return;
      }

      if (!state.promptBox.value.trim()) {
        setActionError("Prompt box is empty.");
        return;
      }

      const batchSize = currentBatchSize();
      const referenceImages = state.referenceImages;
      if (!(await confirmBulkAction("Generate", 1, batchSize))) {
        return;
      }

      await runMutation(
        "generate",
        () =>
          generateFromPromptBox(productId, {
            shotId,
            prompt: state.promptBox.value,
            settings: currentGenerateSettings(),
            batchSize,
            referenceImages
          }),
        "queue"
      );
    },
    [confirmBulkAction, currentBatchSize, currentGenerateSettings, runMutation]
  );

  const handleGenerateMissing = useCallback(
    async (count: number) => {
      const productId = selectedProductRef.current;

      const batchSize = currentBatchSize();
      const referenceImages = productStateRef.current?.referenceImages ?? [];
      if (!productId || !(await confirmBulkAction("Generate", count, count * batchSize))) {
        return;
      }

      await runMutation(
        "generate-missing",
        () =>
          generateMissing(productId, {
            settings: currentGenerateSettings(),
            batchSize,
            referenceImages
          }),
        "queue"
      );
    },
    [confirmBulkAction, currentBatchSize, currentGenerateSettings, runMutation]
  );

  const handleRetryFailed = useCallback(
    async (shotIds: string[] | undefined, count: number) => {
      const productId = selectedProductRef.current;

      const batchSize = currentBatchSize();
      const referenceImages = productStateRef.current?.referenceImages ?? [];
      if (!productId || !(await confirmBulkAction("Retry", count, count * batchSize))) {
        return;
      }

      await runMutation(
        "retry-failed",
        () =>
          retryFailed(productId, {
            settings: currentGenerateSettings(),
            batchSize,
            referenceImages,
            ...(shotIds ? { shotIds } : {})
          }),
        "queue"
      );
    },
    [confirmBulkAction, currentBatchSize, currentGenerateSettings, runMutation]
  );

  const handleCancelPending = useCallback(() => {
    const activeJobs = selectedProductJobs.filter(isRunningJob);

    if (activeJobs.length === 0) {
      return;
    }

    if (
      activeJobs.length > 1 &&
      !window.confirm(`Cancel ${pluralize(activeJobs.length, "active job")} for this product?`)
    ) {
      return;
    }

    void runMutation(
      "cancel-active",
      () => Promise.all(activeJobs.map((job) => cancelJob(job.jobId))),
      "queue"
    );
  }, [runMutation, selectedProductJobs]);

  const handleAccept = useCallback(
    (assetId: string) => {
      const productId = selectedProductRef.current;

      if (productId) {
        void runMutation("accept", () => acceptAsset(productId, assetId));
      }
    },
    [runMutation]
  );

  const handleReject = useCallback(
    (assetId: string) => {
      const productId = selectedProductRef.current;

      if (productId) {
        void runMutation("reject", async () => {
          await rejectAsset(productId, assetId);
          setShowTrash(true);
        });
      }
    },
    [runMutation]
  );

  const handleRetryAsset = useCallback(
    (assetId: string) => {
      const productId = selectedProductRef.current;

      if (productId) {
        void runMutation("retry-exact", () => retryAsset(productId, assetId), "queue");
      }
    },
    [runMutation]
  );

  const handlePanelResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftPanelWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setLeftPanelWidth(clampPanelWidth(startWidth + moveEvent.clientX - startX));
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.classList.remove("isResizingPanels");
      };

      document.body.classList.add("isResizingPanels");
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [leftPanelWidth]
  );

  const handlePanelResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setLeftPanelWidth((width) => clampPanelWidth(width + (event.key === "ArrowLeft" ? -32 : 32)));
    }

    if (event.key === "Home") {
      event.preventDefault();
      setLeftPanelWidth(MIN_LEFT_PANEL_WIDTH);
    }

    if (event.key === "End") {
      event.preventDefault();
      setLeftPanelWidth(clampPanelWidth(window.innerWidth - MIN_RIGHT_PANEL_WIDTH));
    }
  }, []);

  const handleMasterShotsSave = useCallback(
    (nextMasterShots: MasterShots) => {
      void runMutation("save-master-shots", async () => {
        const saved = await updateMasterShots({
          ...nextMasterShots,
          updatedAt: new Date().toISOString()
        });
        setMasterShots(saved);
      });
    },
    [runMutation]
  );

  const handleBackgroundManifestSave = useCallback(
    (manifestPath: string) => {
      void runMutation("background-library", async () => {
        setBackgroundLibrary(await updateBackgroundManifest(manifestPath));
      });
    },
    [runMutation]
  );

  const handleBackgroundLibraryRescan = useCallback(() => {
    void runMutation("rescan-backgrounds", async () => {
      setBackgroundLibrary(await rescanBackgroundLibrary());
    });
  }, [runMutation]);

  const handleLabelLogoSave = useCallback(
    (labelLogoPath: string) => {
      void runMutation("label-logo", async () => {
        setBackgroundLibrary(await updateLabelLogoPath(labelLogoPath));
      });
    },
    [runMutation]
  );

  const handleProductBackgroundChange = useCallback(
    (backgroundId: string | null) => {
      const productId = selectedProductRef.current;
      if (!productId) return;
      void runMutation("select-background", async () => {
        const state = await updateProductBackground(productId, backgroundId);
        setProductState(state);
        productStateRef.current = state;
      });
    },
    [runMutation]
  );

  const handleCreateProduct = useCallback(
    async (name: string) => {
      await runMutation("create-product", async () => {
        const product = await createProduct(name);
        setSelectedProductId(product.id);
        setMode("generate");
      });
    },
    [runMutation]
  );

  const handleUploadRefineReference = useCallback(
    (file: File) => {
      const productId = selectedProductRef.current;
      if (!productId) return;
      void runMutation("upload-reference", async () => {
        await uploadRefineReference(productId, {
          data: await readFileAsDataUrl(file),
          mimeType: file.type
        });
      });
    },
    [runMutation]
  );

  const handleStartRefine = useCallback(() => {
    const productId = selectedProductRef.current;
    if (!productId) return;
    const state = productStateRef.current;
    const imageSize = state?.settings.imageSize ?? "4K";
    const patternMode = state?.refinePatternMode ?? "symmetrical";
    const variationCount = state?.refineVariationCount ?? 3;
    const sosPaletteId = state?.sosPaletteId ?? "auto_flip";
    const sosCustomPalette = state?.sosCustomPalette ?? DEFAULT_SOS_CUSTOM_PALETTE;
    const sosDesignChange = state?.sosDesignChange ?? false;
    void runMutation(
      "refine",
      () =>
        startRefine(
          productId,
          imageSize,
          patternMode,
          variationCount,
          sosPaletteId,
          sosCustomPalette,
          sosDesignChange
        ),
      "queue"
    );
  }, [runMutation]);

  const handleRefineImageSizeChange = useCallback(
    (imageSize: ImageSize) => handleSettingsChange({ imageSize }),
    [handleSettingsChange]
  );

  const handleRefinePatternModeChange = useCallback(
    (refinePatternMode: RefinePatternMode) => {
      updateStateDraft((current) => ({ ...current, refinePatternMode }), true);
    },
    [updateStateDraft]
  );

  const handleRefineVariationCountChange = useCallback(
    (refineVariationCount: number) => {
      updateStateDraft((current) => ({ ...current, refineVariationCount }), true);
    },
    [updateStateDraft]
  );

  const handleSosPaletteChange = useCallback(
    (sosPaletteId: SosPaletteId) => {
      updateStateDraft((current) => ({ ...current, sosPaletteId }), true);
    },
    [updateStateDraft]
  );

  const handleSosCustomPaletteChange = useCallback(
    (sosCustomPalette: SosCustomPalette) => {
      updateStateDraft((current) => ({ ...current, sosPaletteId: "custom", sosCustomPalette }), true);
    },
    [updateStateDraft]
  );

  const handleSosDesignChange = useCallback(
    (sosDesignChange: boolean) => {
      updateStateDraft((current) => ({ ...current, sosDesignChange }), true);
    },
    [updateStateDraft]
  );

  const handleSaveRecentSosPalette = useCallback(async (palette: SosCustomPalette) => {
    setBusyAction("save-sos-palette");
    setActionError(null);
    try {
      setRefineSettings(await saveRecentSosPalette(palette));
      return true;
    } catch (error) {
      setActionError(getErrorMessage(error));
      return false;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleSaveRefinePrompt = useCallback(
    async (mode: RefinePatternMode, prompt: string) => {
      let saved = false;
      await runMutation("save-refine-prompt", async () => {
        setRefineSettings(await updateRefineSettings(mode, prompt));
        saved = true;
      });
      return saved;
    },
    [runMutation]
  );

  const handleValidateRefine = useCallback(
    (assetId: string) => {
      const productId = selectedProductRef.current;
      if (!productId) return;
      void runMutation("validate-refine", () => validateRefineVariation(productId, assetId));
    },
    [runMutation]
  );

  const handleConstructionChange = useCallback(
    (constructionId: RugConstructionId | null) => {
      updateStateDraft(
        (current) => ({
          ...current,
          selectedConstructionId: constructionId
        }),
        true
      );
    },
    [updateStateDraft]
  );

  const handlePreviousAsset = useCallback(() => {
    const selectedAssetId = productStateRef.current?.selectedAssetId;
    const index = allAssets.findIndex((asset) => asset.assetId === selectedAssetId);

    if (index > 0) {
      handleSelectAsset(allAssets[index - 1].assetId);
    }
  }, [allAssets, handleSelectAsset]);

  const handleNextAsset = useCallback(() => {
    const selectedAssetId = productStateRef.current?.selectedAssetId;
    const index = allAssets.findIndex((asset) => asset.assetId === selectedAssetId);

    if (index >= 0 && index < allAssets.length - 1) {
      handleSelectAsset(allAssets[index + 1].assetId);
    }
  }, [allAssets, handleSelectAsset]);

  const isBusy = isLoadingShell || isLoadingProduct || Boolean(busyAction);
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelWidth}px`
  } as CSSProperties;

  return (
    <div className="appShell">
      <ProductTabs
        products={products}
        selectedProductId={selectedProductId}
        search={search}
        loading={isBusy}
        onSearchChange={setSearch}
        onSelectProduct={handleSelectProduct}
        onRescan={handleRescan}
        onCreateProduct={() => setCreateModalOpen(true)}
      />

      {shellError || selectedError || actionError ? (
        <div className="appAlert">
          {shellError ? <span>Startup: {shellError}</span> : null}
          {selectedError ? <span>Product: {selectedError}</span> : null}
          {actionError ? <span>Action: {actionError}</span> : null}
        </div>
      ) : null}

      {selectedProduct?.status === "missing_base" ? (
        <RefineStep
          product={selectedProduct}
          generated={generated}
          jobs={selectedProductJobs}
          refineSettings={refineSettings}
          imageSize={productState?.settings.imageSize ?? "4K"}
          patternMode={productState?.refinePatternMode ?? "symmetrical"}
          variationCount={productState?.refineVariationCount ?? 3}
          sosPaletteId={productState?.sosPaletteId ?? "auto_flip"}
          sosCustomPalette={productState?.sosCustomPalette ?? DEFAULT_SOS_CUSTOM_PALETTE}
          sosDesignChange={productState?.sosDesignChange ?? false}
          busyAction={busyAction}
          onUploadReference={handleUploadRefineReference}
          onRefine={handleStartRefine}
          onImageSizeChange={handleRefineImageSizeChange}
          onPatternModeChange={handleRefinePatternModeChange}
          onVariationCountChange={handleRefineVariationCountChange}
          onSosPaletteChange={handleSosPaletteChange}
          onSosCustomPaletteChange={handleSosCustomPaletteChange}
          onSosDesignChange={handleSosDesignChange}
          onSaveRecentSosPalette={handleSaveRecentSosPalette}
          onSavePrompt={handleSaveRefinePrompt}
          onValidate={handleValidateRefine}
        />
      ) : (
        <div className="workspace" style={workspaceStyle}>
          <LeftPanel
            product={selectedProduct}
            generated={generated}
            jobs={selectedProductJobs}
            assets={allAssets}
            selectedAssetId={productState?.selectedAssetId ?? null}
            showTrash={showTrash}
            actionDisabled={Boolean(busyAction)}
            runningShotIds={runningShotIds}
            onShowTrashChange={setShowTrash}
            onSelectAsset={handleSelectAsset}
            onAccept={handleAccept}
            onReject={handleReject}
            onRetry={handleRetryAsset}
            onCancelJob={(jobId) => void runMutation("cancel-job", () => cancelJob(jobId))}
          />

          <div
            className="panelResizer"
            role="separator"
            aria-label="Resize panels"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={handlePanelResizePointerDown}
            onKeyDown={handlePanelResizeKeyDown}
          />

          <RightPanel
            mode={mode}
            product={selectedProduct}
            masterShots={masterShots}
            productState={productState}
            backgroundLibrary={backgroundLibrary}
            generated={generated}
            jobs={selectedProductJobs}
            selectedAsset={selectedAsset}
            compareAssets={allAssets}
            onModeChange={setMode}
            onLoadShot={handleLoadShot}
            savingState={savingState}
            busyAction={busyAction}
            runningShotIds={runningShotIds}
            onPromptChange={handlePromptChange}
            onSettingsChange={handleSettingsChange}
            onReferencesChange={handleReferencesChange}
            onGeneratePrompt={handleGeneratePrompt}
            onGenerateMissing={handleGenerateMissing}
            onRetryFailed={handleRetryFailed}
            onCancelPending={handleCancelPending}
            onMasterShotsSave={handleMasterShotsSave}
            onBackgroundManifestSave={handleBackgroundManifestSave}
            onBackgroundLibraryRescan={handleBackgroundLibraryRescan}
            onLabelLogoSave={handleLabelLogoSave}
            onProductBackgroundChange={handleProductBackgroundChange}
            onConstructionChange={handleConstructionChange}
            onPreviousAsset={handlePreviousAsset}
            onNextAsset={handleNextAsset}
            onAccept={handleAccept}
            onReject={handleReject}
            onRetry={handleRetryAsset}
          />
        </div>
      )}

      <footer className="statusBar">
        <span>{products.length} products</span>
        <span>{masterShots?.shots.length ?? 0} master shots</span>
        {appInfo ? (
          <span>
            Provider: {appInfo.providerMode}
            {appInfo.providerMode === "laozhang" && appInfo.endpointHost ? ` (${appInfo.endpointHost})` : ""}
          </span>
        ) : null}
        {appInfo ? <span>Queue: {appInfo.queueConcurrency}</span> : null}
        <span>{selectedProductJobs.filter(isRunningJob).length} running</span>
        {busyAction ? <span>Working: {busyAction}</span> : null}
      </footer>

      {confirmation ? (
        <ConfirmationModal
          request={confirmation}
          onCancel={() => closeConfirmation(false)}
          onConfirm={() => closeConfirmation(true)}
        />
      ) : null}
      {createModalOpen ? (
        <CreateProductModal
          busy={Boolean(busyAction)}
          onCancel={() => setCreateModalOpen(false)}
          onCreate={(name) => {
            setCreateModalOpen(false);
            void handleCreateProduct(name);
          }}
        />
      ) : null}
    </div>
  );
}

function clampPanelWidth(value: number) {
  if (typeof window === "undefined") {
    return value;
  }

  const max = Math.max(MIN_LEFT_PANEL_WIDTH, window.innerWidth - MIN_RIGHT_PANEL_WIDTH);
  return Math.min(Math.max(value, MIN_LEFT_PANEL_WIDTH), max);
}

function ConfirmationModal({
  request,
  onCancel,
  onConfirm
}: {
  request: ConfirmationRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modalOverlay" role="presentation">
      <section className="confirmModal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div>
          <h2 id="confirm-title">{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <dl className="confirmDetails">
          {request.details.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <div className="confirmActions">
          <button className="confirmButtonSecondary" type="button" onClick={onCancel}>
            {request.cancelLabel}
          </button>
          <button className="confirmButtonPrimary" type="button" onClick={onConfirm}>
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function CreateProductModal({
  busy,
  onCancel,
  onCreate
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmedName = name.trim();

  return (
    <div className="modalOverlay" role="presentation">
      <section className="confirmModal createProductModal" role="dialog" aria-modal="true" aria-labelledby="create-product-title">
        <div>
          <h2 id="create-product-title">Create product</h2>
          <p>Name the product. The folder will be created with a sanitized slug.</p>
        </div>
        <label className="fieldStack">
          <span>Product name</span>
          <input value={name} autoFocus onChange={(event) => setName(event.target.value)} placeholder="Vintage Oushak 8x10" />
        </label>
        <div className="confirmActions">
          <button className="controlButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="controlButton primary" type="button" disabled={busy || !trimmedName} onClick={() => onCreate(trimmedName)}>
            Create
          </button>
        </div>
      </section>
    </div>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image file."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image file.")));
    reader.readAsDataURL(file);
  });
}
