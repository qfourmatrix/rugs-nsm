import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  GripVertical,
  Image as ImageIcon,
  LoaderCircle,
  PackageCheck,
  Plus,
  ShieldCheck,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { getAvailableGalleryDownloads, type AvailableGalleryDownload, type GalleryReceiptSummary } from "../api";
import type {
  AssetRecord,
  GalleryExportJob,
  GalleryPreflight,
  GallerySelection,
  GeneratedResponse,
  MasterShots,
  ProductShape,
  ProductSummary
} from "../../shared/types";
import {
  galleryExportDownloadUrl,
  cancelGalleryExport,
  getGalleryExportJob,
  getGalleryExportReceipts,
  getGallerySelection,
  getGenerated,
  preflightGalleryExport,
  startGalleryExport,
  thumbnailUrl,
  updateGalleryReadiness,
  updateGallerySelection
} from "../api";
import { getErrorMessage } from "../utils";
import { FamilyShapeStatus } from "./FamilyShapeStatus";
import "../gallery-workspace-v2.css";

const SHAPES: ProductShape[] = ["area", "runner", "round"];
const UTILITY_SHOTS = new Set(["refine_base", "shape_runner_base", "shape_round_base"]);
const emptyGenerated: GeneratedResponse = { active: [], trash: [], aggregates: {} };

interface GalleryExportWorkspaceProps {
  products: ProductSummary[];
  currentProduct: ProductSummary | null;
  masterShots: MasterShots | null;
  onClose: () => void;
  onGalleryChanged?: () => void;
  initialExportId?: string | null;
  onExportStarted?: (exportId: string) => void;
}

export function hasGalleryBase(product: ProductSummary) {
  return Boolean(product.baseImage) && product.status === "ready";
}

export function toggleFamilySelection(family: ProductSummary[], selected: Set<string>) {
  const next = new Set(selected);
  if (family.some((product) => next.has(product.id))) {
    family.forEach((product) => next.delete(product.id));
  } else {
    family.filter((product) => hasGalleryBase(product) && product.exportReady && !product.readinessError)
      .forEach((product) => next.add(product.id));
  }
  return next;
}

export function familySelectionState(family: ProductSummary[], selected: Set<string>) {
  const available = family.filter(hasGalleryBase);
  const count = available.filter((product) => selected.has(product.id)).length;
  return { count, total: available.length, checked: available.length > 0 && count === available.length, mixed: count > 0 && count < available.length };
}

export function selectedProductIdsForExport(
  products: ProductSummary[],
  familyIds: Set<string>,
  shapes: Set<ProductShape>
) {
  return products
    .filter((product) => familyIds.has(product.familyId) && shapes.has(product.shape))
    .map((product) => product.id);
}

export function moveGalleryAsset(assetIds: string[], assetId: string, direction: -1 | 1) {
  const index = assetIds.indexOf(assetId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= assetIds.length) return assetIds;
  const next = [...assetIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function GalleryExportWorkspace({
  products,
  currentProduct,
  onClose,
  onGalleryChanged,
  initialExportId,
  onExportStarted
}: GalleryExportWorkspaceProps) {
  const initialProduct = currentProduct ?? products[0] ?? null;
  const [selectedIds, setSelectedIds] = useState(() => toggleFamilySelection(products.filter((product) => product.familyId === initialProduct?.familyId), new Set()));
  const [search, setSearch] = useState("");
  const [selectionNotice, setSelectionNotice] = useState<{ familyId: string; message: string } | null>(null);
  const [gallerySummaries, setGallerySummaries] = useState<Record<string, GallerySelection>>({});
  const [activeFamilyId, setActiveFamilyId] = useState(initialProduct?.familyId ?? "");
  const [preflight, setPreflight] = useState<GalleryPreflight | null>(null);
  const [exportJob, setExportJob] = useState<GalleryExportJob | null>(null);
  const initialExportIdRef = useRef(initialExportId);
  const [restoringExport, setRestoringExport] = useState(Boolean(initialExportId));
  const [receipts, setReceipts] = useState<GalleryReceiptSummary[]>([]);
  const [receiptCursors, setReceiptCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextReceiptCursor, setNextReceiptCursor] = useState<string | null>(null);
  const [receiptRetry, setReceiptRetry] = useState(0);
  const receiptPageRef = useRef<HTMLSpanElement>(null);
  const receiptCursor = receiptCursors.at(-1);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [availableDownloads, setAvailableDownloads] = useState<AvailableGalleryDownload[]>([]);
  const [downloadListError, setDownloadListError] = useState<string | null>(null);
  const [savingProducts, setSavingProducts] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [startingExport, setStartingExport] = useState(false);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [preflightFingerprint, setPreflightFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const preflightRequestIdRef = useRef(0);
  const exportInFlightRef = useRef(false);
  const autoDownloadedRef = useRef<string | null>(null);
  const issueRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (!showHistory) return;
    const controller = new AbortController();
    let inFlight = false;
    let failures = 0, retryAt = 0;
    const refresh = async () => {
      if (inFlight || document.hidden || controller.signal.aborted || Date.now() < retryAt) return;
      inFlight = true;
      try {
        const downloads = await getAvailableGalleryDownloads(controller.signal);
        if (!controller.signal.aborted) { failures = 0; retryAt = 0; setAvailableDownloads(downloads); setDownloadListError(null); }
      } catch (error) {
        if (!controller.signal.aborted) {
          retryAt = Date.now() + Math.min(30000, 5000 * 2 ** Math.min(++failures, 3));
          setDownloadListError(getErrorMessage(error));
        }
      }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [showHistory]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const previousProductsRef = useRef(products);

  const families = useMemo(() => {
    const map = new Map<string, ProductSummary[]>();
    for (const source of products) {
      const summary = gallerySummaries[source.id];
      const product = summary && summary.revision >= (source.galleryRevision ?? 0)
        ? { ...source, exportReady: summary.exportReady, galleryRevision: summary.revision }
        : source;
      const family = map.get(product.familyId) ?? [];
      family.push(product);
      map.set(product.familyId, family);
    }
    for (const family of map.values()) family.sort((left, right) => SHAPES.indexOf(left.shape) - SHAPES.indexOf(right.shape));
    return map;
  }, [products, gallerySummaries]);
  const activeFamily = families.get(activeFamilyId) ?? [];
  const filteredFamilies = [...families.entries()].filter(([id, family]) => `${id} ${family[0]?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedProductIds = useMemo(
    () => products.filter((product) => selectedIds.has(product.id)).map((product) => product.id),
    [products, selectedIds]
  );
  const selectedFamilies = new Set(products.filter((product) => selectedIds.has(product.id)).map((product) => product.familyId));
  const selectionFingerprint = `${selectedProductIds.join("\u0000")}|${galleryRevision}|${products.filter((product) => selectedIds.has(product.id)).map((product) => `${product.id}:${product.galleryRevision}:${product.exportReady}:${product.baseImage}`).join("|")}`;
  const selectionFingerprintRef = useRef(selectionFingerprint);
  selectionFingerprintRef.current = selectionFingerprint;
  onCloseRef.current = onClose;
  const jobRunning = exportJob?.status === "queued" || exportJob?.status === "building";
  const workflowLocked = checking || savingProducts.size > 0 || startingExport || jobRunning || restoringExport;
  const preflightIsCurrent = Boolean(preflight && preflightFingerprint === selectionFingerprint);
  const unexpectedSkips = exportJob?.receipt?.shapes.filter((shape) => shape.status === "skipped" && !preflight?.shapes.some((checked) => checked.productId === shape.productId && checked.status === "skipped")) ?? [];
  const selectedImageCount = preflightIsCurrent && preflight
    ? preflight.shapes.reduce((count, shape) => count + shape.itemCount, 0)
    : selectedProductIds.every((id) => gallerySummaries[id])
      ? selectedProductIds.reduce((count, id) => count + gallerySummaries[id].assetIds.length + 1, 0)
      : null;
  // Accepted builds belong to the server. Only unfinished local writes/admission lock closing.
  const closeLocked = checking || savingProducts.size > 0 || startingExport;
  const jobRunningRef = useRef(closeLocked);

  useEffect(() => {
    jobRunningRef.current = closeLocked;
  }, [closeLocked]);

  useEffect(() => {
    const id = initialExportIdRef.current;
    if (!id) return;
    const controller = new AbortController();
    void getGalleryExportJob(id, controller.signal).then(job => {
      if (!controller.signal.aborted) setExportJob(job);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(`Could not restore the previous export: ${getErrorMessage(reason)}. No new export was started.`);
    }).finally(() => { if (!controller.signal.aborted) setRestoringExport(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const overlay = dialogRef.current?.parentElement;
    const backgroundSiblings = overlay?.parentElement
      ? [...overlay.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      : [];
    const siblingState = backgroundSiblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden")
    }));
    // Let the opener's click finish before making the background inert. This
    // avoids interrupting pointer activation while preserving modal isolation.
    const isolateTimer = window.setTimeout(() => {
      for (const element of backgroundSiblings) {
        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      }
    }, 1000);
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !jobRunningRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.closest('details:not([open])') || element.matches('summary'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(isolateTimer);
      for (const { element, inert, ariaHidden } of siblingState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".galleryExportTopbarButton")?.focus());
    };
  }, []);

  useEffect(() => { setReceiptCursors([undefined]); }, [showHistory, exportJob?.exportId, exportJob?.status]);

  useEffect(() => {
    if (!showHistory) return;
    const controller = new AbortController();
    setReceiptsLoading(true);
    setReceiptError(null);
    setReceipts([]);
    setNextReceiptCursor(null);
    void getGalleryExportReceipts(controller.signal, receiptCursor).then(next => {
      if (!controller.signal.aborted) { setReceipts(next.receipts); setNextReceiptCursor(next.nextCursor); }
    }).catch(reason => {
      if (!controller.signal.aborted) setReceiptError(getErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setReceiptsLoading(false);
    });
    return () => controller.abort();
  }, [showHistory, exportJob?.exportId, exportJob?.status, receiptCursor, receiptRetry]);

  useEffect(() => {
    const changedIds = products.filter((product) => {
      const previous = previousProductsRef.current.find((entry) => entry.id === product.id);
      return previous && (product.galleryRevision ?? 0) > (previous.galleryRevision ?? 0) && !product.exportReady;
    }).map((product) => product.id);
    previousProductsRef.current = products;
    if (changedIds.length) setSelectedIds((current) => {
      const next = new Set(current);
      changedIds.forEach((id) => next.delete(id));
      return next;
    });
  }, [products]);

  // Fetch only selected galleries, including those outside the open family.
  // Bound concurrency so a large batch does not flood the local API.
  useEffect(() => {
    let cancelled = false;
    const pending = selectedProductIds.filter((id) => !gallerySummaries[id] || gallerySummaries[id].revision < (products.find((product) => product.id === id)?.galleryRevision ?? 0));
    const worker = async () => {
      while (pending.length && !cancelled) {
        const id = pending.shift()!;
        try {
          const next = await getGallerySelection(id);
          if (!cancelled) galleryChanged(next, false);
        } catch { /* Automatic export checks will report the affected shape. */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    return () => { cancelled = true; };
  }, [selectedProductIds.join("\0"), products.map((product) => `${product.id}:${product.galleryRevision}`).join("|")]);

  useEffect(() => {
    if (!reviewTarget) return;
    const section = document.getElementById(`gallery-shape-${reviewTarget}`);
    section?.scrollIntoView?.({ block: "start" });
    section?.focus();
    setReviewTarget(null);
  }, [activeFamilyId, reviewTarget]);

  useEffect(() => {
    if (preflightIsCurrent && preflight && preflight.skippedCount > 0) issueRef.current?.focus();
  }, [preflight, preflightIsCurrent]);

  useEffect(() => {
    preflightRequestIdRef.current += 1;
    setPreflight(null);
    setPreflightFingerprint(null);
    setChecking(false);
    setExportJob((current) => current && ["ready", "downloaded", "failed"].includes(current.status) ? null : current);
  }, [selectionFingerprint]);

  useEffect(() => {
    if ((!jobRunning && exportJob?.status !== "ready") || !exportJob) return undefined;
    const controller = new AbortController();
    let inFlight = false;
    let failures = 0, retryAt = 0;
    const poll = async () => {
      if (inFlight || document.hidden || controller.signal.aborted || Date.now() < retryAt) return;
      inFlight = true;
      try {
        const next = await getGalleryExportJob(exportJob.exportId, controller.signal);
        if (!controller.signal.aborted) {
          failures = 0; retryAt = 0;
          setExportJob(next);
          setError(null);
        }
      } catch (pollError) {
        if (!controller.signal.aborted) {
          retryAt = Date.now() + Math.min(30000, 800 * 2 ** Math.min(++failures, 6));
          setError(getErrorMessage(pollError));
        }
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void poll(), 800);
    const onVisible = () => { if (!document.hidden) { retryAt = 0; void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [exportJob?.exportId, exportJob?.status]);

  useEffect(() => {
    if (exportJob?.status !== "ready" || unexpectedSkips.length > 0 || autoDownloadedRef.current === exportJob.exportId) return;
    autoDownloadedRef.current = exportJob.exportId;
    downloadExport();
  }, [exportJob?.exportId, exportJob?.status]);

  const toggleFamily = (familyId: string) => {
    const family = families.get(familyId) ?? [];
    if (!family.some((product) => selectedIds.has(product.id)) && !family.some((product) => hasGalleryBase(product) && product.exportReady && !product.readinessError)) {
      setSelectionNotice({ familyId, message: "No ready shapes. Review this rug, or include a yellow shape below." });
      setActiveFamilyId(familyId);
    } else setSelectionNotice(null);
    setSelectedIds((current) => toggleFamilySelection(family, current));
  };

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const selectReady = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredFamilies.forEach(([, family]) => family.filter((product) => hasGalleryBase(product) && product.exportReady && !product.readinessError).forEach((product) => next.add(product.id)));
      return next;
    });
    setSelectionNotice(null);
  };

  const galleryChanged = (next: GallerySelection, changed: boolean) => {
    setGallerySummaries((current) => {
      if ((current[next.productId]?.revision ?? -1) >= next.revision) return current;
      return { ...current, [next.productId]: next };
    });
    if (changed) {
      if (!next.exportReady) {
        setSelectedIds((current) => { const updated = new Set(current); updated.delete(next.productId); return updated; });
        const product = products.find((entry) => entry.id === next.productId);
        if (product) setSelectionNotice({ familyId: product.familyId, message: `${shapeLabel(product.shape)} changed. Mark ready again or explicitly include it.` });
      }
      setGalleryRevision((current) => current + 1);
      onGalleryChanged?.();
    }
  };

  const exportSelected = async () => {
    if (selectedProductIds.length === 0 || workflowLocked || exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    const requestId = preflightRequestIdRef.current + 1;
    preflightRequestIdRef.current = requestId;
    const fingerprint = selectionFingerprintRef.current;
    const productIds = [...selectedProductIds];
    setChecking(true);
    setError(null);
    setExportJob(null);
    setPreflight(null);
    setPreflightFingerprint(null);
    try {
      const result = await preflightGalleryExport(productIds);
      if (preflightRequestIdRef.current === requestId && selectionFingerprintRef.current === fingerprint) {
        const changed = result.shapes.filter((shape) => shape.galleryRevision !== undefined && shape.galleryRevision !== (gallerySummaries[shape.productId]?.revision ?? products.find((product) => product.id === shape.productId)?.galleryRevision ?? 0));
        if (changed.length) {
          setError("A gallery changed since you reviewed it. Review the updated shape and export again.");
          await Promise.all(changed.map(async (shape) => galleryChanged(await getGallerySelection(shape.productId), true)));
          return;
        }
        setPreflight(result);
        setPreflightFingerprint(fingerprint);
        if (result.skippedCount === 0 && result.readyCount > 0) {
          await buildExport(result);
        }
      } else {
        setError("The selection changed during checks. Review it and export again.");
      }
    } catch (preflightError) {
      if (preflightRequestIdRef.current === requestId) setError(getErrorMessage(preflightError));
    } finally {
      if (preflightRequestIdRef.current === requestId) setChecking(false);
      exportInFlightRef.current = false;
    }
  };

  const buildExport = async (checked: GalleryPreflight) => {
    const productIds = [...checked.productIds];
    setError(null);
    setStartingExport(true);
    try {
      const expectedFingerprints = Object.fromEntries(checked.shapes.filter((shape) => shape.contentFingerprint).map((shape) => [shape.productId, shape.contentFingerprint!]));
      const job = await startGalleryExport(productIds, expectedFingerprints);
      setExportJob(job);
      onExportStarted?.(job.exportId);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    } finally {
      setStartingExport(false);
    }
  };

  const downloadExport = () => {
    if (!exportJob || exportJob.status !== "ready") return;
    const anchor = document.createElement("a");
    anchor.href = galleryExportDownloadUrl(exportJob.exportId);
    anchor.download = exportJob.archiveFilename ?? "gallery-export.zip";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const reviewShape = (productId: string) => {
    const product = products.find((entry) => entry.id === productId);
    if (product) { setActiveFamilyId(product.familyId); setReviewTarget(productId); }
  };

  return (
    <div className="galleryExportOverlay">
      <section className="galleryExportWorkspace galleryWorkspaceV2" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gallery-export-title">
        <header className="galleryExportHeader">
          <div className="galleryExportTitle">
            <PackageCheck size={19} aria-hidden="true" />
            <div>
              <h2 id="gallery-export-title">Gallery export</h2>
              <p>Select rugs, review their galleries, then export.</p>
            </div>
          </div>
          <div className="galleryExportHeaderMeta">
            <button type="button" className="galleryHistoryButton" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>Recent exports</button>
            <button ref={closeRef} type="button" onClick={onClose} disabled={closeLocked} aria-label="Close gallery export">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="galleryExportBody">
          <aside className="galleryFamilyPanel">
            <div className="galleryPanelHeading">
              <div>
                <strong>Choose rugs</strong>
                <span>Checkbox adds ready shapes</span>
              </div>
              <button type="button" onClick={selectReady} disabled={workflowLocked} title="Add ready shapes from matching families">Select ready</button>
            </div>
            <div className="galleryFamilySearch">
              <label htmlFor="gallery-family-search">Find a rug</label>
              <input id="gallery-family-search" type="search" placeholder="Search rug families" value={search} onChange={(event) => setSearch(event.target.value)} />
              <small>Green ready · yellow not ready · grey missing</small>
            </div>
            <div className="galleryFamilyList" aria-label="Product families">
              {filteredFamilies.map(([familyId, family]) => {
                const representative = family.find((product) => product.shape === "area") ?? family[0];
                const selection = familySelectionState(family, selectedIds);
                const active = activeFamilyId === familyId;
                const selected = family.filter((product) => selectedIds.has(product.id));
                const imageCount = selected.every((product) => gallerySummaries[product.id]) ? selected.reduce((sum, product) => sum + gallerySummaries[product.id].assetIds.length + 1, 0) : null;
                return (
                  <div className={`galleryFamilyRow ${active ? "isActive" : ""} ${selection.count ? "isIncluded" : ""}`} key={familyId}>
                    <label>
                      <input type="checkbox" checked={selection.checked} ref={(input) => { if (input) input.indeterminate = selection.mixed; }} aria-checked={selection.mixed ? "mixed" : selection.checked} onChange={() => toggleFamily(familyId)} aria-label={`Export ${representative.name}: ${selection.count} of ${selection.total} shapes selected`} disabled={workflowLocked || selection.total === 0} />
                    </label>
                    <button type="button" onClick={() => setActiveFamilyId(familyId)} aria-current={active ? "true" : undefined} aria-label={`Review ${representative.name} galleries`} aria-describedby={`gallery-family-status-${familyId}`}>
                      <div className="galleryFamilyThumb">{representative.baseImage ? <img loading="lazy" src={thumbnailUrl(representative.id, "base", representative.baseImage)} alt="" /> : <ImageIcon size={18} />}</div>
                      <div className="galleryFamilyCopy"><span>{representative.name}</span><small>{selected.length ? `${selected.map((product) => shapeLabel(product.shape)).join(" + ")}${imageCount === null ? " · counting…" : ` · ${imageCount} ${imageCount === 1 ? "image" : "images"}`}` : active ? "Viewing · not selected" : "Not selected"}</small></div>
                      <FamilyShapeStatus products={family} familyName={representative.name} />
                    </button>
                    {selectionNotice?.familyId === familyId ? <p className="galleryFamilyNotice" role="status">{selectionNotice.message}</p> : null}
                    <span id={`gallery-family-status-${familyId}`} className="galleryVisuallyHidden">{SHAPES.map((shape) => { const product = family.find((entry) => entry.shape === shape); return `${shape}: ${product?.readinessError ? "readiness unavailable" : !product?.baseImage ? "missing" : product.exportReady ? "ready for export" : "not ready for export"}`; }).join(". ")}</span>
                  </div>
                );
              })}
              {filteredFamilies.length === 0 ? <p className="galleryExportHint">No rugs match this search. Your export selection is unchanged.</p> : null}
            </div>
          </aside>

          <main className="galleryCurationPanel">
            <div className="galleryCurationHeader">
              <div>
                <h3>{activeFamily.find((product) => product.shape === "area")?.name ?? activeFamily[0]?.name ?? "No family selected"}</h3>
                <p>Images export in this order. Main stays first.</p>
              </div>
              <FamilyShapeStatus products={activeFamily} familyName={activeFamilyId} />
            </div>

            <div className="galleryCurationScroll">
              {preflightIsCurrent && preflight && preflight.skippedCount > 0 && !exportJob ? <div className="galleryCheckIssues" ref={issueRef} tabIndex={-1} role="alert">
                <strong>{preflight.skippedCount} {preflight.skippedCount === 1 ? "shape needs" : "shapes need"} attention</strong>
                <p>{preflight.readyCount ? `${preflight.readyCount} valid ${preflight.readyCount === 1 ? "shape can" : "shapes can"} still export. Nothing has been downloaded yet.` : "No selected shapes passed the checks. Fix an issue or change your selection."}</p>
                <PreflightResults preflight={preflight} onReview={reviewShape} />
                <div className="galleryIssueActions">
                  {preflight.readyCount > 0 ? <button className="galleryPrimaryButton" type="button" disabled={workflowLocked} onClick={() => {
                    if (exportInFlightRef.current) return;
                    exportInFlightRef.current = true;
                    void buildExport(preflight).finally(() => { exportInFlightRef.current = false; });
                  }}>Export {preflight.readyCount} valid {preflight.readyCount === 1 ? "shape" : "shapes"}</button> : null}
                  <button className="gallerySecondaryButton" type="button" disabled={workflowLocked} onClick={() => reviewShape(preflight.shapes.find((shape) => shape.status === "skipped")!.productId)}>Go fix it</button>
                </div>
              </div> : null}
              {showHistory ? <section className="galleryHistory"><div className="galleryPanelHeading"><strong>Recent exports</strong><button type="button" onClick={() => setShowHistory(false)}>Close history</button></div><p>Receipts are kept. Downloaded ZIPs are removed.</p>
                {downloadListError ? <p role="alert">Could not check available ZIPs: {downloadListError}</p> : null}
                {availableDownloads.map(download => <article key={`download-${download.exportId}`}>
                  <strong>Awaiting download · {download.includedShapes} shapes · {formatBytes(download.archiveBytes)}</strong>
                  <span>{formatDateTime(download.completedAt)}{download.skippedShapes ? ` · ${download.skippedShapes} shapes skipped` : ""}</span>
                  <a className="gallerySecondaryButton" href={galleryExportDownloadUrl(download.exportId)} download={download.archiveFilename}>Download existing ZIP</a>
                </article>)}
                {receiptError ? <p role="alert">Could not load export history: {receiptError} <button type="button" onClick={() => { receiptPageRef.current?.focus(); setReceiptRetry(value => value + 1); }}>Retry history</button></p> : null}
                {receiptsLoading ? <p role="status">Loading export history…</p> : !receiptError && receipts.length === 0 ? <p>No exports yet.</p> : null}
                {receipts.map((receipt) => <article key={receipt.exportId}><strong>{receipt.includedShapes} shapes · {formatBytes(receipt.archiveBytes)}</strong><span>{formatDateTime(receipt.completedAt)} · {receipt.downloadedAt ? "Downloaded" : "Built"}{receipt.skippedShapes ? ` · ${receipt.skippedShapes} skipped` : ""}</span></article>)}
                <nav aria-label="Export history pages" className="galleryPanelHeading">
                  <button type="button" disabled={receiptsLoading || receiptCursors.length === 1} onClick={() => { receiptPageRef.current?.focus(); setReceiptCursors(current => current.slice(0, -1)); }}>Newer exports</button>
                  <span role="status" tabIndex={-1} ref={receiptPageRef}>Page {receiptCursors.length}</span>
                  <button type="button" disabled={receiptsLoading || !nextReceiptCursor} onClick={() => { if (nextReceiptCursor) { receiptPageRef.current?.focus(); setReceiptCursors(current => [...current, nextReceiptCursor]); } }}>Older exports</button>
                </nav>
              </section> : null}
              {SHAPES.map((shape) => {
                const product = activeFamily.find((candidate) => candidate.shape === shape);
                return product && hasGalleryBase(product) ? (
                  <ShapeGallery key={product.id} product={product} included={selectedIds.has(product.id)} disabled={workflowLocked}
                    onToggle={() => toggleProduct(product.id)} onChange={galleryChanged}
                    onSaving={(saving) => setSavingProducts((current) => { const next = new Set(current); if (saving) next.add(product.id); else next.delete(product.id); return next; })} />
                ) : <section id={product ? `gallery-shape-${product.id}` : undefined} tabIndex={-1} className="galleryShapeSection isUnavailable" key={`${activeFamilyId}-${shape}`} aria-label={`${shape} gallery`}><div className="galleryShapeHeading"><h4>{shape}</h4><span>{product?.baseImage ? "Base needs attention" : "Shape missing — no main image"}</span><label><input type="checkbox" disabled /> Include in export</label></div></section>;
              })}
            </div>
          </main>

        </div>
        <footer className="galleryExportBar">
          {showBreakdown ? <div className="galleryBatchBreakdown"><strong>Included in this download</strong>{selectedProductIds.length ? [...families.entries()].filter(([id]) => selectedFamilies.has(id)).map(([id, family]) => <button type="button" key={id} onClick={() => { setActiveFamilyId(id); setShowBreakdown(false); }}><strong>{family[0]?.name}</strong><span>{family.filter((product) => selectedIds.has(product.id)).map((product) => shapeLabel(product.shape)).join(" + ")}</span></button>) : <p>Check a rug or include a shape to start.</p>}</div> : null}
          {error ? <div className="galleryExportError" role="alert"><AlertTriangle size={14} /><span>{error}</span></div> : null}
          {unexpectedSkips.length > 0 ? <div className="galleryExportError" role="alert"><AlertTriangle size={14} /><span>Files changed during export. {unexpectedSkips.map((shape) => `${shape.familyId} ${shapeLabel(shape.shape)}`).join(", ")} were left out. Review them, or download the {exportJob?.receipt?.includedShapes} valid shapes below.</span></div> : null}
          {preflightIsCurrent && preflight && (preflight.skippedCount === 0 || exportJob) && preflight.shapes.some((shape) => shape.issues.length > 0) ? <details className="galleryExportWarnings"><summary>{preflight.skippedCount ? `Export notes · ${preflight.skippedCount} skipped` : "Export notes (non-blocking)"}</summary><PreflightResults preflight={preflight} onReview={reviewShape} /></details> : null}
          {exportJob ? <ExportProgress job={exportJob} /> : null}
          {restoringExport ? <p role="status">Restoring previous export…</p> : jobRunning ? <p>You can close this workspace and keep working. Reopen it to check this export.</p> : null}
          {jobRunning && exportJob ? <button className="gallerySecondaryButton" type="button" onClick={() => {
            void cancelGalleryExport(exportJob.exportId).then(setExportJob).catch(reason => setError(getErrorMessage(reason)));
          }}>Cancel export</button> : null}
          <div className="galleryExportBarMain">
            <div className="galleryBatchSummary"><button type="button" aria-expanded={showBreakdown} onClick={() => setShowBreakdown((value) => !value)}>{selectedFamilies.size} rugs · {selectedProductIds.length} shape galleries · {selectedImageCount === null ? "Counting images…" : `${selectedImageCount} images`}</button><span>{selectedProductIds.length ? "Checks run automatically. Originals + Shopify WebPs in one ZIP." : "Choose rugs on the left. Green shapes are included by default."}</span></div>
            {selectedProductIds.length > 0 ? <button className="galleryTextButton" type="button" disabled={workflowLocked} onClick={() => setSelectedIds(new Set())}>Clear</button> : null}
            {exportJob?.status === "ready" ? <button className="galleryPrimaryButton" type="button" onClick={downloadExport}><Download size={15} /> {unexpectedSkips.length ? "Download valid shapes" : "Download ZIP"}</button> : <button className={preflightIsCurrent && preflight?.skippedCount && !exportJob ? "gallerySecondaryButton" : "galleryPrimaryButton"} type="button" onClick={() => void exportSelected()} disabled={workflowLocked || selectedProductIds.length === 0}>
              {workflowLocked ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{jobRunning || startingExport ? "Preparing ZIP…" : checking ? "Checking images…" : savingProducts.size ? "Saving gallery…" : preflightIsCurrent && preflight?.skippedCount && !exportJob ? "Check again" : "Export selected"}
            </button>}
          </div>
        </footer>
      </section>
    </div>
  );
}

function ShapeGallery({ product, included, disabled, onToggle, onChange, onSaving }: {
  product: ProductSummary;
  included: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (gallery: GallerySelection, changed: boolean) => void;
  onSaving: (saving: boolean) => void;
}) {
  const [gallery, setGallery] = useState<GallerySelection | null>(null);
  const [generated, setGenerated] = useState<GeneratedResponse>(emptyGenerated);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [dragged, setDragged] = useState<string | null>(null);
  const mounted = useRef(true);
  const galleryRef = useRef(gallery);
  const savingRef = useRef(false);
  const changeRef = useRef(onChange);
  const sectionRef = useRef<HTMLElement>(null);
  galleryRef.current = gallery;
  changeRef.current = onChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([getGallerySelection(product.id), getGenerated(product.id)])
      .then(([next, assets]) => {
        if (cancelled) return;
        const previousRevision = galleryRef.current?.revision;
        setGallery(next);
        setGenerated(assets);
        changeRef.current(next, previousRevision !== undefined && previousRevision !== next.revision);
      })
      .catch((reason) => { if (!cancelled) setError(getErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [product.id, product.galleryRevision, reload]);

  const accepted = generated.active.filter((asset) => asset.status === "accepted" && asset.output && !UTILITY_SHOTS.has(asset.shotId) && !asset.inputs.shapeVariant);
  const acceptedById = new Map(accepted.map((asset) => [asset.assetId, asset]));
  const available = accepted.filter((asset) => !gallery?.assetIds.includes(asset.assetId));
  const counts = new Map<string, { name: string; count: number }>();
  for (const id of gallery?.assetIds ?? []) {
    const asset = acceptedById.get(id);
    if (asset) counts.set(asset.shotId, { name: asset.shotName, count: (counts.get(asset.shotId)?.count ?? 0) + 1 });
  }
  const locked = disabled || loading || saving || !gallery;
  const save = async (assetIds: string[]) => {
    if (!gallery || locked || savingRef.current || assetIds.join("\0") === gallery.assetIds.join("\0")) return;
    savingRef.current = true;
    setSaving(true);
    onSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateGallerySelection(product.id, assetIds, gallery.revision);
      changeRef.current(next, true);
      if (mounted.current) {
        setGallery(next);
        setNotice("Gallery changed — review and mark ready again.");
        // Preserve focus if the activated remove/restore control disappeared.
        window.requestAnimationFrame(() => {
          if (document.activeElement === document.body) sectionRef.current?.focus();
        });
      }
    } catch (reason) {
      if (mounted.current) {
        setError(`${getErrorMessage(reason)} Your latest saved gallery will be reloaded; try the change again.`);
        setReload((current) => current + 1);
      }
    } finally {
      savingRef.current = false;
      onSaving(false);
      if (mounted.current) setSaving(false);
    }
  };
  const dropBefore = (target: string) => {
    if (locked || !gallery || !dragged || dragged === target || !gallery.assetIds.includes(dragged)) return;
    const next = gallery.assetIds.filter((id) => id !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    setDragged(null);
    void save(next);
  };
  const ready = gallery?.exportReady ?? product.exportReady;
  const markReadiness = async () => {
    if (!gallery || locked || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSaving(true);
    setError(null);
    try {
      const next = await updateGalleryReadiness(product.id, !ready, gallery.revision);
      changeRef.current(next, true);
      if (mounted.current) { setGallery(next); setNotice(next.exportReady ? "Gallery approved." : "Marked not ready."); }
    } catch (reason) {
      if (mounted.current) { setError(getErrorMessage(reason)); setReload((value) => value + 1); }
    } finally {
      savingRef.current = false;
      onSaving(false);
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <section id={`gallery-shape-${product.id}`} ref={sectionRef} tabIndex={-1} className={`galleryShapeSection ${gallery?.assetIds.length === 0 ? "isBaseOnly" : ""}`} aria-label={`${product.shape} gallery`} aria-busy={loading || saving}>
      <div className="galleryShapeHeading">
        <div><h4>{product.shape}</h4><span className={ready ? "isReady" : "isNotReady"}>{loading ? "Loading review status…" : ready ? "Ready for export" : "Not ready for export"}</span>{gallery ? <small>{gallery.assetIds.length + 1} {gallery.assetIds.length === 0 ? "image" : "images"}</small> : null}</div>
        <div className="galleryShapeControls"><button type="button" className={`galleryReadinessButton ${ready ? "isReady" : ""}`} aria-label={`Mark ${product.shape} ${ready ? "not ready" : "ready"}`} disabled={locked} onClick={() => void markReadiness()}>{ready ? "Mark not ready" : "Mark ready"}</button><label><input type="checkbox" checked={included} onChange={onToggle} disabled={locked} aria-label={`Include ${product.shape} in export`} /> {included ? "Included" : "Include in export"}</label></div>
      </div>
      {included && !ready && !loading ? <p className="galleryShapeWarning"><AlertTriangle size={13} /> Included, but not marked ready. Files will still be checked.</p> : null}
      {error ? <div className="galleryInlineNotice isBlocking" role="alert"><XCircle size={14} /><span>{error}</span><button type="button" disabled={saving || loading} onClick={() => { setError(null); setReload((current) => current + 1); }}>Retry</button></div> : null}
      {loading && !gallery ? <div className="galleryShapeLoading"><LoaderCircle className="spin" size={16} /> Loading {product.shape} gallery…</div> : gallery ? <>
        <div className="gallerySectionLabel"><span>{gallery.assetIds.length === 0 ? "Base-only gallery — accepted generations are optional." : "Drag to reorder, or use the move buttons."}</span><span role="status">{saving ? "Saving…" : notice ?? "Saved"}</span></div>
        <div className="galleryOrderedList">
          <GalleryMainRow product={product} />
          {gallery.assetIds.map((assetId, index) => <GalleryAssetRow key={assetId} product={product} asset={acceptedById.get(assetId) ?? null} assetId={assetId}
            position={index + 2} first={index === 0} last={index === gallery.assetIds.length - 1} disabled={locked} dragging={dragged === assetId}
            onDragStart={() => setDragged(assetId)} onDragEnd={() => setDragged(null)} onDrop={() => dropBefore(assetId)}
            onMove={(direction) => void save(moveGalleryAsset(gallery.assetIds, assetId, direction))}
            onRemove={() => void save(gallery.assetIds.filter((id) => id !== assetId))} />)}
        </div>
        {[...counts.entries()].filter(([, value]) => value.count > 1).map(([id, value]) => <div key={id} className="galleryInlineNotice isWarning"><AlertTriangle size={14} /><span>{value.count} selected images use {value.name}. Duplicates are allowed.</span></div>)}
        {available.length > 0 ? <details className="galleryRestoreDisclosure">
          <summary>Available accepted images ({available.length})</summary>
          <p>Removed images stay here and can be restored.</p>
          {available.length ? <div className="galleryAvailableGrid">{available.map((asset) => <button type="button" key={asset.assetId} disabled={locked} onClick={() => void save([...gallery.assetIds, asset.assetId])} aria-label={`Restore ${asset.shotName}, attempt ${asset.attempt}, to ${product.shape} gallery`}><AssetThumb productId={product.id} asset={asset} /><span><strong>{asset.shotName}</strong><small>Attempt {asset.attempt}</small></span><Plus size={15} /></button>)}</div> : <p>No other accepted images for this shape.</p>}
        </details> : null}
      </> : null}
    </section>
  );
}

function GalleryMainRow({ product }: { product: ProductSummary }) {
  return (
    <article className="galleryOrderRow isMain">
      <span className="galleryPosition">01</span>
      <div className="galleryOrderThumb">
        {product.baseImage ? <img src={thumbnailUrl(product.id, "base", product.baseImage)} alt={`${product.name} main image`} /> : <ImageIcon size={18} />}
      </div>
      <div className="galleryOrderCopy"><strong>Main image</strong><span>{product.baseImage ?? "Missing base.*"}</span></div>
      <span className="galleryLock"><ShieldCheck size={13} /> Locked</span>
    </article>
  );
}

function GalleryAssetRow({
  product,
  asset,
  assetId,
  position,
  first,
  last,
  disabled,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
  onRemove
}: {
  product: ProductSummary;
  asset: AssetRecord | null;
  assetId: string;
  position: number;
  first: boolean;
  last: boolean;
  disabled: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const handleDragOver = (event: DragEvent<HTMLElement>) => event.preventDefault();
  return (
    <article
      className={`galleryOrderRow ${dragging ? "isDragging" : ""} ${asset ? "" : "isMissing"}`}
      draggable={Boolean(asset) && !disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
    >
      <span className="galleryPosition">{String(position).padStart(2, "0")}</span>
      <GripVertical className="galleryDragHandle" size={15} aria-hidden="true" />
      <div className="galleryOrderThumb">{asset ? <AssetThumb productId={product.id} asset={asset} /> : <XCircle size={18} />}</div>
      <div className="galleryOrderCopy"><strong>{asset?.shotName ?? "Missing accepted image"}</strong><span>{asset ? `Attempt ${asset.attempt} · ${asset.output?.file}` : assetId}</span></div>
      <div className="galleryOrderActions">
        <button type="button" onClick={() => onMove(-1)} disabled={disabled || first} aria-label={`Move ${asset?.shotName ?? assetId} earlier`} title="Move earlier"><ArrowUp size={14} /></button>
        <button type="button" onClick={() => onMove(1)} disabled={disabled || last} aria-label={`Move ${asset?.shotName ?? assetId} later`} title="Move later"><ArrowDown size={14} /></button>
        <button type="button" onClick={onRemove} disabled={disabled} aria-label={`Remove ${asset?.shotName ?? assetId} from gallery`} title="Remove from gallery"><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

function AssetThumb({ productId, asset }: { productId: string; asset: AssetRecord }) {
  if (!asset.output?.file) return <XCircle size={18} />;
  return <img loading="lazy" src={thumbnailUrl(productId, "generated", asset.output.file)} alt="" />;
}

function PreflightResults({ preflight, onReview }: { preflight: GalleryPreflight; onReview: (productId: string) => void }) {
  return (
    <div className="galleryPreflightResults">
      <div className="galleryPreflightTotals">
        <span className="isReady"><CheckCircle2 size={14} /> {preflight.readyCount} ready</span>
        <span className={preflight.skippedCount ? "isSkipped" : ""}><XCircle size={14} /> {preflight.skippedCount} skipped</span>
      </div>
      <div className="galleryPreflightShapes">
        {preflight.shapes.filter((shape) => shape.issues.length > 0).map((shape) => {
          const blockers = shape.issues.filter((candidate) => candidate.severity === "blocker");
          const warnings = shape.issues.filter((candidate) => candidate.severity === "warning");
          return (
            <details key={shape.productId} open={shape.status === "skipped"}>
              <summary>
                {shape.status === "ready" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                <span>{shape.familyId} · {shape.shape}</span>
                <small>{blockers.length ? `${blockers.length} blocked` : warnings.length ? `${warnings.length} warnings` : `${shape.itemCount} images`}</small>
              </summary>
              {shape.issues.length > 0 ? (
                <ul>{shape.issues.map((item, index) => <li className={`is-${item.severity}`} key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
              ) : <p>Ready to export.</p>}
              <button type="button" className="galleryTextButton" onClick={() => onReview(shape.productId)}>Review {shapeLabel(shape.shape)}</button>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ExportProgress({ job }: { job: GalleryExportJob }) {
  const percent = job.progress.total > 0 ? Math.min(100, Math.round((job.progress.completed / job.progress.total) * 100)) : 0;
  return (
    <div className={`galleryJobProgress status-${job.status}`} aria-live="polite">
      <div><strong>{job.status === "ready" ? "ZIP ready — download starting" : job.status === "downloaded" ? "Download complete" : job.status === "cancelled" ? "Export cancelled" : job.status === "failed" ? "Export failed" : "Preparing your export"}</strong><span>{job.status === "ready" ? "If the download does not start, use Download ZIP." : job.progress.message}</span></div>
      {job.status === "building" || job.status === "queued" ? <><progress max={100} value={percent}>{percent}%</progress><small>{percent}% · {job.progress.completed}/{job.progress.total} files</small></> : null}
      {job.error ? <small className="isError">{job.error}</small> : null}
      {job.receipt ? <small>{job.receipt.includedShapes} {job.receipt.includedShapes === 1 ? "shape exported" : "shapes exported"}{job.receipt.skippedShapes ? ` · ${job.receipt.skippedShapes} skipped` : ""}</small> : null}
    </div>
  );
}

function shapeLabel(shape: ProductShape) {
  return shape[0].toUpperCase() + shape.slice(1);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
