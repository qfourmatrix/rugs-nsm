import { createCoalescedRefresh } from "./coalesced-refresh";
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
  acceptAllDoneAssets,
  cancelJob,
  createProduct,
  generateFromPromptBox,
  generateMissing,
  getAppInfo,
  getBackgroundLibrary,
  getGenerated,
  responseCacheWeight,
  getGallerySelection,
  getJobs,
  getJobRevision,
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
  updateGalleryReadiness,
  updateProductBackground,
  updateProductState,
  updateRefineSettings,
  uploadRefineReference,
  validateRefineVariation
} from "./api";
import { LeftPanel } from "./components/LeftPanel";
import { GenerationRecovery } from "./components/GenerationRecovery";
import { GalleryExportWorkspace } from "./components/GalleryExportWorkspace";
import { ProductTabs } from "./components/ProductTabs";
import { RefineStep } from "./components/RefineStep";
import { RightPanel } from "./components/RightPanel";
import { CompletionStack } from "./components/CompletionStack";
import { ShapeVariantStudio } from "./components/ShapeVariantStudio";
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
import "./studio-review.css";
import { clearSavedLocalDraft, findLocalDraft, writeLocalDraft } from "./local-drafts";
import { ActionGate, type PendingAction } from "./action-gate";
import { beginPanelDrag, schedulePanelWidthSave } from "./panel-resize";
import { WeightedLru } from "../shared/weighted-lru";

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
  const productReadController = useRef<AbortController | null>(null);
  const recentGenerated = useRef(new WeightedLru<string, GeneratedResponse>(8, 8 * 1024 * 1024));
  const stateWriteTails = useRef(new Map<string, Promise<boolean>>());
  const activeSaveCount = useRef(0);
  const actionGate = useRef(new ActionGate());
  const productRevisions = useRef(new Map<string, number>());
  const draftOwner = useRef(crypto.randomUUID());
  const recoveryChecked = useRef(new Set<string>());
  const recoveredDrafts = useRef(new Map<string, { key: string; raw: string | null }>());
  const activeQueueIds = useRef(new Set<string>());
  const pendingCompletion = useRef<JobRecord | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [masterShots, setMasterShots] = useState<MasterShots | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productState, setProductState] = useState<ProductState | null>(null);
  const [generated, setGenerated] = useState<GeneratedResponse>(emptyGenerated);
  const generatedRef = useRef(generated);
  generatedRef.current = generated;
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [refineSettings, setRefineSettings] = useState<RefineSettings | null>(null);
  const [backgroundLibrary, setBackgroundLibrary] = useState<BackgroundLibraryState | null>(null);
  const [mode, setMode] = useState<AppMode>("generate");
  const [search, setSearch] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [isLoadingShell, setIsLoadingShell] = useState(true);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [savingProducts, setSavingProducts] = useState<Record<string, number>>({});
  const [failedSaveProducts, setFailedSaveProducts] = useState<Set<string>>(() => new Set());
  const savingState = Boolean(selectedProductId && savingProducts[selectedProductId]);
  const [shellError, setShellError] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const busyActions = new Set(pendingActions.filter(action => action.productId === selectedProductId || ["background-library", "rescan-backgrounds", "label-logo", "save-master-shots"].includes(action.label)).map(action => action.label));
  const busyAction = [...busyActions][0] ?? null;
  const [reviewNotice, setReviewNotice] = useState<{ productId: string; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [galleryExportOpen, setGalleryExportOpen] = useState(false);
  const [lastGalleryExportId, setLastGalleryExportId] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY); } catch { /* Optional preference. */ }
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_LEFT_PANEL_WIDTH;
    return clampPanelWidth(Number.isFinite(parsed) ? parsed : DEFAULT_LEFT_PANEL_WIDTH);
  });
  const panelDragCleanup = useRef<(() => void) | null>(null);

  const selectedProductRef = useRef<string | null>(null);
  const productStateRef = useRef<ProductState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaves = useRef(new Map<string, ProductState>());
  const saveSequences = useRef(new Map<string, number>());
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
      new Set([
        ...selectedProductJobs
          .filter(isRunningJob)
          .map((job) => job.shotId),
        ...pendingActions.filter(action => action.productId === selectedProductId).flatMap(action => action.shotIds.includes("*") ? masterShots?.shots.map(shot => shot.id) ?? [] : action.shotIds)
      ]),
    [selectedProductJobs, pendingActions, selectedProductId, masterShots]
  );

  const allAssets = useMemo(
    () => toLocatedAssets(generated.active, generated.trash).filter((asset) => asset.productId === selectedProductId),
    [generated.active, generated.trash, selectedProductId]
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
    if (!silent) {
      setIsLoadingShell(true);
    }
    setShellError(null);
    const [infoResult, productsResult, shotsResult, jobsResult, libraryResult, refineSettingsResult] = await Promise.allSettled([
      getAppInfo(), getProducts(), getMasterShots(), getJobs(), getBackgroundLibrary(), getRefineSettings()
    ]);
    if (sequence !== shellLoadSequenceRef.current) return;

    setAppInfo(infoResult.status === "fulfilled" ? infoResult.value : null);

    if (productsResult.status === "fulfilled") {
      const nextProducts = productsResult.value;
      setProducts(nextProducts);
      setSelectedProductId((current) => {
        if (current && nextProducts.some((product) => product.id === current)) {
          return current;
        }

        return nextProducts[0]?.id ?? null;
      });
    } else {
      setShellError(getErrorMessage(productsResult.reason));
      setProducts([]);
      setSelectedProductId(null);
    }

    if (shotsResult.status === "fulfilled") {
      setMasterShots(shotsResult.value);
    } else {
      setMasterShots(null);
      setShellError((current) => current ?? getErrorMessage(shotsResult.reason));
    }

    setJobs(jobsResult.status === "fulfilled" ? jobsResult.value : []);

    if (libraryResult.status === "fulfilled") {
      setBackgroundLibrary(libraryResult.value);
    } else {
      setBackgroundLibrary(null);
      setShellError((current) => current ?? getErrorMessage(libraryResult.reason));
    }

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
    // A delayed catalog/rescan continuation must not abort a newer selection.
    if (selectedProductRef.current !== productId) return;
    const sequence = ++productLoadSequenceRef.current;
    productReadController.current?.abort();
    const controller = new AbortController();
    productReadController.current = controller;
    if (!silent) {
      setIsLoadingProduct(true);
      setProductState(null);
      productStateRef.current = null;
      setGenerated(recentGenerated.current.get(productId) ?? emptyGenerated);
    }
    setSelectedError(null);

    try {
      await stateWriteTails.current.get(productId);
      if (controller.signal.aborted) return;
      const [stateResult, generatedResult, jobsResult] = await Promise.allSettled([
        getProductState(productId, controller.signal),
        getGenerated(productId, controller.signal),
        getJobs(controller.signal, productId)
      ]);

      if (controller.signal.aborted || sequence !== productLoadSequenceRef.current || selectedProductRef.current !== productId) {
        return;
      }

      if (stateResult.status === "fulfilled") {
        // Returning to a failed draft must not silently authorize overwriting a newer server revision.
        if (!pendingSaves.current.has(productId)) productRevisions.current.set(productId, stateResult.value.revision ?? 0);
        let next = pendingSaves.current.get(productId) ?? stateResult.value;
        if (!recoveryChecked.current.has(productId)) {
          recoveryChecked.current.add(productId);
          try {
            const draft = findLocalDraft(window.localStorage, productId);
            if (draft && JSON.stringify({ ...draft.state, revision: next.revision }) !== JSON.stringify(next) &&
                window.confirm(`An unsaved draft for ${productId} was recovered (${draft.savedAt}). Restore it in the editor? This may replace settings changed in another tab when you next save. Cancel keeps the server version and leaves the draft stored.`)) {
              next = { ...draft.state, revision: next.revision };
              recoveredDrafts.current.set(productId, { key: draft.key, raw: window.localStorage.getItem(draft.key) });
              pendingSaves.current.set(productId, next);
              writeLocalDraft(window.localStorage, draftOwner.current, next);
            }
          } catch { setActionError("Browser draft recovery is unavailable. Keep this tab open until your changes are saved."); }
        }
        setProductState(next);
        productStateRef.current = next;
      } else {
        setProductState(null);
        productStateRef.current = null;
        setSelectedError(getErrorMessage(stateResult.reason));
      }

      if (generatedResult.status === "fulfilled") {
        setGenerated(generatedResult.value);
        recentGenerated.current.set(productId, generatedResult.value, responseCacheWeight(generatedResult.value));
      } else {
        setGenerated(emptyGenerated);
        setSelectedError((current) => current ?? getErrorMessage(generatedResult.reason));
      }

      if (jobsResult.status === "fulfilled") {
        setJobs(jobsResult.value);
      }
    } finally {
      if (!controller.signal.aborted && sequence === productLoadSequenceRef.current) {
        setIsLoadingProduct(false);
      }
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    const productId = selectedProductRef.current;

    await loadShell(true);

    if (productId && selectedProductRef.current === productId) {
      await loadSelectedProduct(productId, true);
    }
  }, [loadSelectedProduct, loadShell]);

  const refreshCatalog = useMemo(() => {
    const refresh = createCoalescedRefresh(getProducts, next => {
      setProducts(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      return true;
    });
    return async () => {
      try { return await refresh(); }
      catch (error) { setActionError(getErrorMessage(error)); return false; }
    };
  }, []);

  const refreshQueueState = useMemo(() => createCoalescedRefresh(async () => {
      const productId = selectedProductRef.current;
      const [jobsResult, generatedResult] = await Promise.allSettled([
        getJobs(undefined, productId ?? undefined),
        productId ? getGenerated(productId, undefined, generatedRef.current) : Promise.resolve(null)
      ]);
      return { productId, jobsResult, generatedResult };
    }, ({ productId, jobsResult, generatedResult }) => {
      if (jobsResult.status === "fulfilled" && selectedProductRef.current === productId) {
        const nextActive = new Set(jobsResult.value.filter(isRunningJob).map(job => job.jobId));
        if ([...activeQueueIds.current].some(id => !nextActive.has(id))) void refreshCatalog();
        activeQueueIds.current = nextActive;
        setJobs(current => JSON.stringify(current) === JSON.stringify(jobsResult.value) ? current : jobsResult.value);
      }

      if (
        productId &&
        selectedProductRef.current === productId &&
        generatedResult.status === "fulfilled" &&
        generatedResult.value
      ) {
        const next = generatedResult.value;
        setGenerated(current => current === next ? current : next);
      }
      return jobsResult.status === "fulfilled" && generatedResult.status === "fulfilled" && selectedProductRef.current === productId;
  }), [refreshCatalog]);

  const persistProductState = useCallback((productId: string, nextState: ProductState) => {
    const sequence = (saveSequences.current.get(productId) ?? 0) + 1;
    saveSequences.current.set(productId, sequence);
    activeSaveCount.current++;
    setSavingProducts(current => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }));

    const task = (stateWriteTails.current.get(productId) ?? Promise.resolve(true)).then(async () => {
      try {
        const saved = await updateProductState(productId, { ...nextState, revision: productRevisions.current.get(productId) ?? nextState.revision ?? 0 });
        if (sequence === saveSequences.current.get(productId)) setFailedSaveProducts(current => {
          const next = new Set(current); next.delete(productId); return next;
        });
        productRevisions.current.set(productId, saved.revision ?? 0);
        try { clearSavedLocalDraft(window.localStorage, draftOwner.current, nextState); } catch { /* Server save succeeded; leave the recovery copy intact. */ }
        try {
          const recovered = recoveredDrafts.current.get(productId);
          if (recovered && window.localStorage.getItem(recovered.key) === recovered.raw) window.localStorage.removeItem(recovered.key);
          recoveredDrafts.current.delete(productId);
        } catch { /* Keep the recovery copy if browser storage is unavailable. */ }

        if (selectedProductRef.current === productId && sequence === saveSequences.current.get(productId) && !pendingSaves.current.has(productId)) {
          setProductState(saved);
          productStateRef.current = saved;
        }
        return true;
      } catch (error) {
        setActionError(`${productId}: ${getErrorMessage(error)}`);
        if (sequence === saveSequences.current.get(productId) && !pendingSaves.current.has(productId)) {
          pendingSaves.current.set(productId, nextState);
          setFailedSaveProducts(current => new Set(current).add(productId));
        }
        return false;
      } finally {
        activeSaveCount.current--;
        setSavingProducts(current => {
          const next = { ...current };
          if ((next[productId] ?? 0) <= 1) delete next[productId];
          else next[productId]--;
          return next;
        });
      }
    });
    stateWriteTails.current.set(productId, task);
    void task.then(() => {
      if (stateWriteTails.current.get(productId) === task) stateWriteTails.current.delete(productId);
    });
    return task;
  }, []);

  const runPendingSave = useCallback((productId = selectedProductRef.current) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!productId) return Promise.resolve(true);
    const pending = pendingSaves.current.get(productId);
    pendingSaves.current.delete(productId);

    if (pending) {
      return persistProductState(productId, pending);
    }
    return stateWriteTails.current.get(productId) ?? Promise.resolve(true);
  }, [persistProductState]);

  const scheduleProductStateSave = useCallback(
    (nextState: ProductState, immediate = false) => {
      const productId = selectedProductRef.current;

      if (!productId) {
        return;
      }

      setProductState(nextState);
      productStateRef.current = nextState;
      try { writeLocalDraft(window.localStorage, draftOwner.current, nextState); }
      catch { setActionError("Could not store a local recovery draft. Keep this tab open until Saved is shown."); }
      pendingSaves.current.set(productId, nextState);

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }

      if (immediate) {
        runPendingSave(productId);
      } else {
        saveTimerRef.current = window.setTimeout(() => runPendingSave(productId), 450);
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
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (pendingSaves.current.size || activeSaveCount.current > 0) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [savingState]);

  useEffect(() => {
    return () => {
      productReadController.current?.abort();
      panelDragCleanup.current?.();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const hasRunningJobs = jobs.some(isRunningJob) || products.some(product => product.counts.running > 0);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let observedRevision: string | null = null;
    let retryAfter = 0;
    let failures = 0;
    const reconcile = async () => {
      if (disposed || inFlight || document.hidden || Date.now() < retryAfter) return;
      inFlight = true;
      try {
        const revision = await getJobRevision();
        if (!disposed && revision !== observedRevision) {
          // A skipped, failed, or superseded refresh must not acknowledge this revision.
          if (await refreshQueueState()) observedRevision = revision;
        }
        failures = 0;
      } catch {
        failures++;
        retryAfter = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(failures, 4));
      } finally { inFlight = false; }
    };
    const onReturn = () => { if (!document.hidden) { retryAfter = 0; void reconcile(); } };
    const interval = window.setInterval(() => void reconcile(), 15000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refreshQueueState]);
  useEffect(() => {
    if (!hasRunningJobs) {
      return undefined;
    }

    const queueInterval = window.setInterval(() => {
      if (!document.hidden) void refreshQueueState();
    }, 2500);
    const shellInterval = window.setInterval(() => {
      if (!document.hidden) void refreshCatalog();
    }, 12000);

    return () => {
      window.clearInterval(queueInterval);
      window.clearInterval(shellInterval);
    };
  }, [hasRunningJobs, refreshCatalog, refreshQueueState]);

  useEffect(() => {
    return schedulePanelWidthSave(PANEL_WIDTH_STORAGE_KEY, leftPanelWidth);
  }, [leftPanelWidth]);

  const handleSelectProduct = useCallback(
    (productId: string) => {
      pendingCompletion.current = null;
      runPendingSave();
      productReadController.current?.abort();
      selectedProductRef.current = productId;
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

  const handleOpenCompletion = useCallback((job: JobRecord) => {
    handleSelectProduct(job.productId);
    pendingCompletion.current = job;
    setGalleryExportOpen(false);
    setShowTrash(false);
  }, [handleSelectProduct]);

  useEffect(() => {
    const job = pendingCompletion.current;
    if (!job || isLoadingProduct || productState?.productId !== job.productId || selectedProductId !== job.productId) return;
    const asset = allAssets.find(candidate => candidate.assetId === job.assetId && candidate.location === "generated");
    if (!asset) {
      if (!selectedError) setActionError("This completed shot is no longer available. Check the product’s shots or trash.");
      pendingCompletion.current = null;
      return;
    }
    pendingCompletion.current = null;
    handleSelectAsset(asset.assetId);
  }, [allAssets, handleSelectAsset, isLoadingProduct, productState, selectedProductId, selectedError]);

  const runMutation = useCallback(
    async (label: string, action: () => Promise<unknown>, refresh: "full" | "queue" | "none" = "full", intendedProductId = selectedProductRef.current, shotIds: string[] = [], resource = "") => {
      // Cancellation must remain possible even while an unrelated save is stalled.
      const independent = ["cancel-job", "cancel-active", "save-master-shots", "background-library", "rescan-backgrounds", "label-logo", "save-refine-prompt", "save-sos-palette", "create-product", "accept", "accept-all", "reject", "export-readiness"].includes(label);
      const ticket = actionGate.current.begin(label, intendedProductId, shotIds, resource);
      if (!ticket) return;
      const targetProductId = intendedProductId;
      setPendingActions(actionGate.current.snapshot());
      setActionError(null);
      // Mutating one rug must not discard every other rug's navigation preview.
      // Cached previews are still revalidated by loadSelectedProduct on each switch.
      if (targetProductId) recentGenerated.current.delete(targetProductId);
      else recentGenerated.current.clear();

      try {
        if (!independent && !(await runPendingSave(targetProductId))) return;
        if (!independent && selectedProductRef.current !== targetProductId) {
          setActionError("Selection changed while saving. Please repeat the action on the intended rug.");
          return;
        }
        await action();
        if (refresh === "queue") {
          // Acceptance is complete. Background status reads must not extend the
          // submission lock while scanning generated files on a slow disk.
          void refreshQueueState();
          void refreshCatalog();
        } else if (refresh === "full") {
          void refreshQueueState();
          // Keep only dependent gallery actions locked until the new revision
          // reaches the UI. Otherwise an immediate Ready click uses the
          // pre-Accept revision while the catalog refresh is still in flight.
          if (["accept", "accept-all", "reject", "export-readiness", "validate-refine"].includes(label)) {
            await refreshCatalog();
          } else {
            void refreshCatalog();
          }
        }
      } catch (error) {
        setActionError(getErrorMessage(error));
      } finally {
        actionGate.current.finish(ticket);
        setPendingActions(actionGate.current.snapshot());
      }
    },
    [refreshCatalog, refreshCurrent, refreshQueueState, runPendingSave]
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
      const settings = currentGenerateSettings();
      const referenceImages = state.referenceImages;
      const context = { selectedBackgroundId: state.selectedBackgroundId, selectedConstructionId: state.selectedConstructionId };
      if (!(await confirmBulkAction("Generate", 1, batchSize))) {
        return;
      }

      await runMutation(
        "generate",
        () =>
          generateFromPromptBox(productId, {
            context,
            shotId,
            prompt: state.promptBox.value,
            settings,
            batchSize,
            referenceImages
          }),
        "queue", productId, [shotId]
      );
    },
    [confirmBulkAction, currentBatchSize, currentGenerateSettings, runMutation]
  );

  const handleGenerateMissing = useCallback(
    async (count: number) => {
      const productId = selectedProductRef.current;

      const batchSize = currentBatchSize();
      const settings = currentGenerateSettings();
      const referenceImages = productStateRef.current?.referenceImages ?? [];
      const context = { selectedBackgroundId: productStateRef.current?.selectedBackgroundId ?? null, selectedConstructionId: productStateRef.current?.selectedConstructionId ?? null };
      if (!productId || !(await confirmBulkAction("Generate", count, count * batchSize))) {
        return;
      }

      await runMutation(
        "generate-missing",
        () =>
          generateMissing(productId, {
            context,
            settings,
            batchSize,
            referenceImages
          }),
        "queue", productId, ["*"]
      );
    },
    [confirmBulkAction, currentBatchSize, currentGenerateSettings, runMutation]
  );

  const handleRetryFailed = useCallback(
    async (shotIds: string[] | undefined, count: number) => {
      const productId = selectedProductRef.current;

      const batchSize = currentBatchSize();
      const settings = currentGenerateSettings();
      const referenceImages = productStateRef.current?.referenceImages ?? [];
      if (!productId || !(await confirmBulkAction("Retry", count, count * batchSize))) {
        return;
      }

      await runMutation(
        "retry-failed",
        () =>
          retryFailed(productId, {
            settings,
            batchSize,
            referenceImages,
            ...(shotIds ? { shotIds } : {})
          }),
        "queue", productId, shotIds ?? ["*"]
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
        void runMutation("accept", async () => {
          await acceptAsset(productId, assetId);
          setReviewNotice({ productId, message: "Accepted. Gallery changed — review and mark ready again." });
        });
      }
    },
    [runMutation]
  );

  const handleAcceptAllDone = useCallback((assetIds: string[]) => {
    const productId = selectedProductRef.current;
    if (!productId || assetIds.length === 0) return;
    void runMutation("accept-all", async () => {
      const result = await acceptAllDoneAssets(productId, assetIds);
      const accepted = result.results.filter((item) => item.status === "accepted").length;
      const skipped = result.results.filter((item) => item.status === "skipped");
      setReviewNotice({ productId, message: `${accepted} accepted${skipped.length ? ` · ${skipped.length} skipped (${[...new Set(skipped.map((item) => item.reason ?? "Asset changed"))].join(", ")})` : ""}${accepted ? ". Gallery changed — review and mark ready again." : "."}` });
    });
  }, [runMutation]);

  const handleExportReadyChange = useCallback((exportReady: boolean) => {
    const productId = selectedProductRef.current;
    if (!productId || !selectedProduct || selectedProduct.id !== productId || Boolean(selectedProduct.exportReady) === exportReady) return;
    const expectedRevision = selectedProduct.galleryRevision;
    void runMutation("export-readiness", async () => {
      try {
        const revision = expectedRevision ?? (await getGallerySelection(productId)).revision;
        await updateGalleryReadiness(productId, exportReady, revision);
        setReviewNotice({ productId, message: exportReady ? "Marked ready for export." : "Marked not ready for export." });
      } catch (error) {
        await loadShell(true);
        throw error;
      }
    });
  }, [loadShell, runMutation, selectedProduct]);

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
        const shotId = allAssets.find(asset => asset.assetId === assetId)?.shotId;
        void runMutation("retry-exact", () => retryAsset(productId, assetId), "queue", productId, [shotId ?? "*"]);
      }
    },
    [runMutation, allAssets]
  );

  const handlePanelResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftPanelWidth;
      panelDragCleanup.current?.();

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setLeftPanelWidth(clampPanelWidth(startWidth + moveEvent.clientX - startX));
      };

      panelDragCleanup.current = beginPanelDrag(handlePointerMove);
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
      // Share the revision-aware draft queue with prompt/settings edits. A late
      // background response must never replace a newer editor draft.
      updateStateDraft(current => ({ ...current, selectedBackgroundId: backgroundId }), true);
    },
    [updateStateDraft]
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
    let saved = false;
    await runMutation("save-sos-palette", async () => {
      setRefineSettings(await saveRecentSosPalette(palette));
      saved = true;
    }, "none");
    return saved;
  }, [runMutation]);

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

  const isBusy = isLoadingShell || isLoadingProduct;
  const galleryBusy = ["accept", "accept-all", "reject", "export-readiness", "validate-refine"].some(label => busyActions.has(label));
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelWidth}px`
  } as CSSProperties;

  return (
    <div className="appShell">
      <div className="appHeaderStack">
        <ProductTabs
          products={products}
          selectedProductId={selectedProductId}
          search={search}
          loading={isBusy}
          navigationLoading={isLoadingShell}
          onSearchChange={setSearch}
          onSelectProduct={handleSelectProduct}
          onRescan={handleRescan}
          onCreateProduct={() => setCreateModalOpen(true)}
          onOpenGalleryExport={() => setGalleryExportOpen(true)}
        />
        <ShapeVariantStudio
          products={products}
          selectedProduct={selectedProduct}
          loading={isBusy}
          onSelectProduct={handleSelectProduct}
          onCatalogChanged={refreshCurrent}
        />

        {shellError || selectedError || actionError || (selectedProductId && failedSaveProducts.has(selectedProductId)) ? (
          <div className="appAlert">
            {shellError ? <span>Startup: {shellError}</span> : null}
            {selectedError ? <span>Product: {selectedError}</span> : null}
            {actionError ? <span>Action: {actionError}</span> : null}
            {!actionError && selectedProductId && failedSaveProducts.has(selectedProductId) ? <span>This rug has an unsaved draft. Retry saving or reload the saved version.</span> : null}
            {selectedProductId && pendingSaves.current.has(selectedProductId) ? <div>
              <button className="miniButton" type="button" disabled={savingState} onClick={() => void runPendingSave(selectedProductId)}>Retry saving this rug</button>{" "}
              <button className="miniButton" type="button" disabled={savingState} onClick={() => {
                const productId = selectedProductId;
                if (!window.confirm("Load the saved server version? Your unsaved draft will remain in browser recovery storage. It will not overwrite the server version.")) return;
                const originalDraft = pendingSaves.current.get(productId);
                const originalSequence = saveSequences.current.get(productId);
                void getProductState(productId).then(saved => {
                  if (pendingSaves.current.get(productId) !== originalDraft || saveSequences.current.get(productId) !== originalSequence) {
                    setActionError("The draft changed while reloading. Your newer edits were kept; retry reload if needed.");
                    return;
                  }
                  pendingSaves.current.delete(productId);
                  setFailedSaveProducts(current => { const next = new Set(current); next.delete(productId); return next; });
                  stateWriteTails.current.delete(productId);
                  productRevisions.current.set(productId, saved.revision ?? 0);
                  if (selectedProductRef.current === productId) {
                    setProductState(saved); productStateRef.current = saved; setActionError(null);
                  }
                }).catch(error => setActionError(getErrorMessage(error)));
              }}>Reload saved version</button>
            </div> : null}
          </div>
        ) : null}
        <GenerationRecovery />
      </div>

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
            actionDisabled={isBusy || galleryBusy}
            runningShotIds={runningShotIds}
            onShowTrashChange={setShowTrash}
            onSelectAsset={handleSelectAsset}
            onAccept={handleAccept}
            onAcceptAllDone={handleAcceptAllDone}
            acceptingAll={busyActions.has("accept-all")}
            reviewNotice={reviewNotice?.productId === selectedProductId ? reviewNotice.message : null}
            onReject={handleReject}
            onRetry={handleRetryAsset}
            onCancelJob={(jobId) => void runMutation("cancel-job", () => cancelJob(jobId), "queue", selectedProductId, [], jobId)}
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
            onExportReadyChange={handleExportReadyChange}
            onLoadShot={handleLoadShot}
            savingState={savingState}
            busyAction={isBusy ? "loading-product" : null}
            busyActions={busyActions}
            galleryBusy={galleryBusy}
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
        {pendingActions.length ? <span>Working: {pendingActions.map(action => `${action.label}${action.productId ? ` (${action.productId})` : ""}`).join(", ")}</span> : null}
      </footer>

      <CompletionStack jobs={jobs} currentProductId={selectedProductId} onOpen={handleOpenCompletion} />
      {confirmation ? (
        <ConfirmationModal
          request={confirmation}
          onCancel={() => closeConfirmation(false)}
          onConfirm={() => closeConfirmation(true)}
        />
      ) : null}
      {createModalOpen ? (
        <CreateProductModal
          busy={busyActions.has("create-product")}
          onCancel={() => setCreateModalOpen(false)}
          onCreate={(name) => {
            setCreateModalOpen(false);
            void handleCreateProduct(name);
          }}
        />
      ) : null}
      {galleryExportOpen ? (
        <GalleryExportWorkspace
          initialExportId={lastGalleryExportId}
          onExportStarted={setLastGalleryExportId}
          products={products}
          currentProduct={selectedProduct}
          masterShots={masterShots}
          onClose={() => setGalleryExportOpen(false)}
          onGalleryChanged={() => { setReviewNotice(null); void loadShell(true); }}
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
