import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Download,
  GripVertical,
  Image as ImageIcon,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type {
  AssetRecord,
  GalleryExportJob,
  GalleryExportReceipt,
  GalleryPreflight,
  GallerySelection,
  GeneratedResponse,
  MasterShots,
  ProductShape,
  ProductSummary
} from "../../shared/types";
import {
  galleryExportDownloadUrl,
  getGalleryExportJob,
  getGalleryExportReceipts,
  getGallerySelection,
  getGenerated,
  preflightGalleryExport,
  startGalleryExport,
  thumbnailUrl,
  updateGallerySelection
} from "../api";
import { getErrorMessage } from "../utils";

const SHAPES: ProductShape[] = ["area", "runner", "round"];
const UTILITY_SHOTS = new Set(["refine_base", "shape_runner_base", "shape_round_base"]);
const emptyGenerated: GeneratedResponse = { active: [], trash: [], aggregates: {} };

interface GalleryExportWorkspaceProps {
  products: ProductSummary[];
  currentProduct: ProductSummary | null;
  masterShots: MasterShots | null;
  onClose: () => void;
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
  masterShots,
  onClose
}: GalleryExportWorkspaceProps) {
  const initialProduct = currentProduct ?? products[0] ?? null;
  const [selectedFamilies, setSelectedFamilies] = useState(() => new Set(initialProduct ? [initialProduct.familyId] : []));
  const [selectedShapes, setSelectedShapes] = useState<Set<ProductShape>>(() => new Set(initialProduct ? [initialProduct.shape] : ["area"]));
  const [activeFamilyId, setActiveFamilyId] = useState(initialProduct?.familyId ?? "");
  const [activeShape, setActiveShape] = useState<ProductShape>(initialProduct?.shape ?? "area");
  const [gallery, setGallery] = useState<GallerySelection | null>(null);
  const [generated, setGenerated] = useState<GeneratedResponse>(emptyGenerated);
  const [preflight, setPreflight] = useState<GalleryPreflight | null>(null);
  const [exportJob, setExportJob] = useState<GalleryExportJob | null>(null);
  const [receipts, setReceipts] = useState<GalleryExportReceipt[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [savingGallery, setSavingGallery] = useState(false);
  const [checking, setChecking] = useState(false);
  const [startingExport, setStartingExport] = useState(false);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [preflightFingerprint, setPreflightFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const preflightRequestIdRef = useRef(0);

  const families = useMemo(() => {
    const map = new Map<string, ProductSummary[]>();
    for (const product of products) {
      const family = map.get(product.familyId) ?? [];
      family.push(product);
      map.set(product.familyId, family);
    }
    for (const family of map.values()) family.sort((left, right) => SHAPES.indexOf(left.shape) - SHAPES.indexOf(right.shape));
    return map;
  }, [products]);
  const activeFamily = families.get(activeFamilyId) ?? [];
  const activeProduct = activeFamily.find((product) => product.shape === activeShape) ?? activeFamily[0] ?? null;
  const selectedProductIds = useMemo(
    () => selectedProductIdsForExport(products, selectedFamilies, selectedShapes),
    [products, selectedFamilies, selectedShapes]
  );
  const selectionFingerprint = `${selectedProductIds.join("\u0000")}|${galleryRevision}`;
  const selectionFingerprintRef = useRef(selectionFingerprint);
  selectionFingerprintRef.current = selectionFingerprint;
  onCloseRef.current = onClose;
  const acceptedAssets = useMemo(
    () => generated.active.filter((asset) => asset.status === "accepted" && asset.output && !UTILITY_SHOTS.has(asset.shotId) && !asset.inputs.shapeVariant),
    [generated.active]
  );
  const acceptedById = useMemo(() => new Map(acceptedAssets.map((asset) => [asset.assetId, asset])), [acceptedAssets]);
  const selectedAssets = gallery?.assetIds.map((assetId) => acceptedById.get(assetId) ?? null) ?? [];
  const availableAssets = acceptedAssets.filter((asset) => !gallery?.assetIds.includes(asset.assetId));
  const duplicateShots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of selectedAssets) if (asset) counts.set(asset.shotId, (counts.get(asset.shotId) ?? 0) + 1);
    return [...counts.entries()].filter(([, count]) => count > 1).map(([shotId, count]) => ({
      shotId,
      count,
      name: selectedAssets.find((asset) => asset?.shotId === shotId)?.shotName ?? shotId
    }));
  }, [selectedAssets]);
  const jobRunning = exportJob?.status === "queued" || exportJob?.status === "building";
  const workflowLocked = checking || savingGallery || startingExport || jobRunning;
  const preflightIsCurrent = Boolean(preflight && preflightFingerprint === selectionFingerprint);
  const jobRunningRef = useRef(jobRunning);

  useEffect(() => {
    jobRunningRef.current = jobRunning;
  }, [jobRunning]);

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
    window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !jobRunningRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )];
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

  useEffect(() => {
    void getGalleryExportReceipts().then(setReceipts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeProduct) {
      setGallery(null);
      setGenerated(emptyGenerated);
      return;
    }
    let cancelled = false;
    setLoadingGallery(true);
    setError(null);
    Promise.all([getGallerySelection(activeProduct.id), getGenerated(activeProduct.id)])
      .then(([nextGallery, nextGenerated]) => {
        if (cancelled) return;
        setGallery(nextGallery);
        setGenerated(nextGenerated);
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadingGallery(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProduct?.id]);

  useEffect(() => {
    preflightRequestIdRef.current += 1;
    setPreflight(null);
    setPreflightFingerprint(null);
    setChecking(false);
  }, [selectionFingerprint]);

  useEffect(() => {
    if (!jobRunning || !exportJob) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getGalleryExportJob(exportJob.exportId);
        if (!cancelled) setExportJob(next);
      } catch (pollError) {
        if (!cancelled) setError(getErrorMessage(pollError));
      }
    };
    const timer = window.setInterval(() => void poll(), 800);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [exportJob?.exportId, jobRunning]);

  const chooseActiveFamily = (familyId: string) => {
    setActiveFamilyId(familyId);
    const family = families.get(familyId) ?? [];
    if (!family.some((product) => product.shape === activeShape)) setActiveShape(family[0]?.shape ?? "area");
  };

  const toggleFamily = (familyId: string) => {
    setSelectedFamilies((current) => {
      const next = new Set(current);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  };

  const toggleShape = (shape: ProductShape) => {
    setSelectedShapes((current) => {
      const next = new Set(current);
      if (next.has(shape)) next.delete(shape);
      else next.add(shape);
      return next;
    });
  };

  const saveAssetIds = async (assetIds: string[]) => {
    if (!activeProduct || !gallery) return;
    const previous = gallery;
    const productId = activeProduct.id;
    preflightRequestIdRef.current += 1;
    setGallery({ ...gallery, assetIds, updatedAt: new Date().toISOString() });
    setSavingGallery(true);
    setGalleryRevision((current) => current + 1);
    setError(null);
    setPreflight(null);
    setPreflightFingerprint(null);
    setChecking(false);
    try {
      setGallery(await updateGallerySelection(productId, assetIds));
    } catch (saveError) {
      setGallery(previous);
      setError(getErrorMessage(saveError));
    } finally {
      setSavingGallery(false);
    }
  };

  const reorder = (assetId: string, direction: -1 | 1) => {
    if (!gallery) return;
    void saveAssetIds(moveGalleryAsset(gallery.assetIds, assetId, direction));
  };

  const dropBefore = (targetId: string) => {
    if (!gallery || !draggedAssetId || draggedAssetId === targetId) return;
    const next = gallery.assetIds.filter((assetId) => assetId !== draggedAssetId);
    const targetIndex = next.indexOf(targetId);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedAssetId);
    setDraggedAssetId(null);
    void saveAssetIds(next);
  };

  const runPreflight = async () => {
    if (selectedProductIds.length === 0 || workflowLocked) return;
    const requestId = preflightRequestIdRef.current + 1;
    preflightRequestIdRef.current = requestId;
    const fingerprint = selectionFingerprintRef.current;
    const productIds = [...selectedProductIds];
    setChecking(true);
    setError(null);
    setPreflight(null);
    setPreflightFingerprint(null);
    try {
      const result = await preflightGalleryExport(productIds);
      if (preflightRequestIdRef.current === requestId && selectionFingerprintRef.current === fingerprint) {
        setPreflight(result);
        setPreflightFingerprint(fingerprint);
      }
    } catch (preflightError) {
      if (preflightRequestIdRef.current === requestId) setError(getErrorMessage(preflightError));
    } finally {
      if (preflightRequestIdRef.current === requestId) setChecking(false);
    }
  };

  const buildExport = async () => {
    if (!preflight || !preflightIsCurrent || preflight.readyCount === 0 || workflowLocked) return;
    const productIds = [...preflight.productIds];
    setError(null);
    setStartingExport(true);
    try {
      setExportJob(await startGalleryExport(productIds));
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
    window.setTimeout(() => {
      void Promise.all([getGalleryExportJob(exportJob.exportId), getGalleryExportReceipts()])
        .then(([nextJob, nextReceipts]) => {
          setExportJob(nextJob);
          setReceipts(nextReceipts);
        })
        .catch(() => undefined);
    }, 1200);
  };

  return (
    <div className="galleryExportOverlay">
      <section className="galleryExportWorkspace" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gallery-export-title">
        <header className="galleryExportHeader">
          <div className="galleryExportTitle">
            <PackageCheck size={19} aria-hidden="true" />
            <div>
              <h2 id="gallery-export-title">Gallery export</h2>
              <p>Curate main and generated images for Shopify-ready ZIPs.</p>
            </div>
          </div>
          <div className="galleryExportHeaderMeta">
            <span>{selectedFamilies.size} {selectedFamilies.size === 1 ? "family" : "families"}</span>
            <span>{selectedProductIds.length} {selectedProductIds.length === 1 ? "shape" : "shapes"}</span>
            <button ref={closeRef} type="button" onClick={onClose} disabled={jobRunning} aria-label="Close gallery export">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="galleryExportBody">
          <aside className="galleryFamilyPanel">
            <div className="galleryPanelHeading">
              <div>
                <strong>Export scope</strong>
                <span>Choose families and shapes</span>
              </div>
              <button type="button" onClick={() => setSelectedFamilies(new Set(families.keys()))} disabled={workflowLocked}>All</button>
            </div>
            <fieldset className="galleryShapeChecks">
              <legend>Shapes</legend>
              {SHAPES.map((shape) => (
                <label key={shape}>
                  <input type="checkbox" checked={selectedShapes.has(shape)} onChange={() => toggleShape(shape)} disabled={workflowLocked} />
                  <span>{shape}</span>
                </label>
              ))}
            </fieldset>
            <div className="galleryFamilyList" aria-label="Product families">
              {[...families.entries()].map(([familyId, family]) => {
                const representative = family.find((product) => product.shape === "area") ?? family[0];
                const selected = selectedFamilies.has(familyId);
                const active = activeFamilyId === familyId;
                return (
                  <div className={`galleryFamilyRow ${active ? "isActive" : ""}`} key={familyId}>
                    <label>
                      <input type="checkbox" checked={selected} onChange={() => toggleFamily(familyId)} aria-label={`Export ${representative.name}`} disabled={workflowLocked} />
                    </label>
                    <button type="button" onClick={() => chooseActiveFamily(familyId)} aria-current={active ? "true" : undefined} disabled={workflowLocked}>
                      <span>{representative.name}</span>
                      <small>{family.map((product) => product.shape).join(" · ")}</small>
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          <main className="galleryCurationPanel">
            <div className="galleryCurationHeader">
              <div>
                <h3>{activeFamilyId || "No family selected"}</h3>
              </div>
              <div className="galleryShapeTabs" role="group" aria-label="Family shapes">
                {SHAPES.map((shape) => {
                  const product = activeFamily.find((candidate) => candidate.shape === shape);
                  return (
                    <button
                      type="button"
                      key={shape}
                      className={activeProduct?.shape === shape ? "isActive" : ""}
                      aria-pressed={activeProduct?.shape === shape}
                      disabled={!product || workflowLocked}
                      onClick={() => setActiveShape(shape)}
                    >
                      {shape}
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingGallery ? (
              <div className="galleryLoading"><LoaderCircle className="spin" size={20} /> Loading gallery</div>
            ) : activeProduct ? (
              <div className="galleryCurationScroll">
                <div className="gallerySectionLabel">
                  <div>
                    <strong>Gallery order</strong>
                    <span>Main image is locked at position 1</span>
                  </div>
                  {savingGallery ? <span className="gallerySaving"><LoaderCircle className="spin" size={12} /> Saving</span> : <span className="gallerySaved"><Check size={12} /> Saved</span>}
                </div>

                <div className="galleryOrderedList">
                  <GalleryMainRow product={activeProduct} />
                  {gallery?.assetIds.map((assetId, index) => (
                    <GalleryAssetRow
                      key={assetId}
                      product={activeProduct}
                      asset={acceptedById.get(assetId) ?? null}
                      assetId={assetId}
                      position={index + 2}
                      first={index === 0}
                      last={index === gallery.assetIds.length - 1}
                      disabled={workflowLocked}
                      dragging={draggedAssetId === assetId}
                      onDragStart={() => setDraggedAssetId(assetId)}
                      onDragEnd={() => setDraggedAssetId(null)}
                      onDrop={() => dropBefore(assetId)}
                      onMove={(direction) => reorder(assetId, direction)}
                      onRemove={() => void saveAssetIds(gallery.assetIds.filter((candidate) => candidate !== assetId))}
                    />
                  ))}
                </div>

                {gallery?.assetIds.length === 0 ? (
                  <div className="galleryInlineNotice isBlocking"><XCircle size={15} /><span>Add at least one accepted generated image before export.</span></div>
                ) : null}
                {duplicateShots.map((duplicate) => (
                  <div className="galleryInlineNotice isWarning" key={duplicate.shotId}>
                    <AlertTriangle size={15} />
                    <span>{duplicate.count} selected images use {duplicate.name}. This is allowed, but worth checking.</span>
                  </div>
                ))}

                <div className="gallerySectionLabel galleryAvailableHeading">
                  <div>
                    <strong>Available accepted images</strong>
                    <span>Removed images stay here and can be restored</span>
                  </div>
                  <span>{availableAssets.length}</span>
                </div>
                {availableAssets.length > 0 ? (
                  <div className="galleryAvailableGrid">
                    {availableAssets.map((asset) => (
                      <button
                        type="button"
                        key={asset.assetId}
                        onClick={() => gallery && void saveAssetIds([...gallery.assetIds, asset.assetId])}
                        disabled={!gallery || workflowLocked}
                      >
                        <AssetThumb productId={activeProduct.id} asset={asset} />
                        <span><strong>{asset.shotName}</strong><small>Attempt {asset.attempt}</small></span>
                        <Plus size={15} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="galleryAvailableEmpty"><ImageIcon size={18} /><span>No other accepted images for this shape.</span></div>
                )}
              </div>
            ) : (
              <div className="galleryLoading">Select a family to curate its gallery.</div>
            )}
          </main>

          <aside className="galleryExportPanel">
            <section className="galleryExportAction">
              <div className="galleryPanelHeading">
                <div><strong>Preflight & export</strong><span>Bad shapes will be skipped</span></div>
                <ShieldCheck size={17} aria-hidden="true" />
              </div>
              <ScopeSummary products={products} productIds={selectedProductIds} />
              {preflight ? <PreflightResults preflight={preflight} /> : (
                <p className="galleryExportHint">Check geometry, acceptance, conversion, and coverage across {masterShots?.shots.length ?? 0} master shot types.</p>
              )}
              {exportJob ? <ExportProgress job={exportJob} /> : null}
              {error ? <div className="galleryExportError" role="alert"><AlertTriangle size={14} /><span>{error}</span></div> : null}
              <div className="galleryExportButtons">
                <button className="gallerySecondaryButton" type="button" onClick={() => void runPreflight()} disabled={workflowLocked || selectedProductIds.length === 0}>
                  {checking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  {preflight ? "Check again" : "Run preflight"}
                </button>
                {exportJob?.status === "ready" ? (
                  <button className="galleryPrimaryButton" type="button" onClick={downloadExport}>
                    <Download size={15} /> Download ZIP
                  </button>
                ) : (
                  <button className="galleryPrimaryButton" type="button" onClick={() => void buildExport()} disabled={!preflightIsCurrent || !preflight || preflight.readyCount === 0 || workflowLocked}>
                    {jobRunning || startingExport ? <LoaderCircle className="spin" size={15} /> : <PackageCheck size={15} />}
                    {jobRunning || startingExport ? "Building ZIP" : "Build ZIP"}
                  </button>
                )}
              </div>
            </section>

            <section className="galleryReceipts">
              <div className="galleryPanelHeading">
                <div><strong>Recent exports</strong><span>Receipts stay; ZIPs do not</span></div>
                <span>{receipts.length}</span>
              </div>
              <div className="galleryReceiptList">
                {receipts.slice(0, 8).map((receipt) => (
                  <article key={receipt.exportId}>
                    <PackageCheck size={15} aria-hidden="true" />
                    <div>
                      <strong>{receipt.includedShapes} {receipt.includedShapes === 1 ? "shape" : "shapes"}</strong>
                      <span>{formatDateTime(receipt.completedAt)} · {formatBytes(receipt.archiveBytes)}</span>
                      {receipt.skippedShapes ? <small>{receipt.skippedShapes} skipped</small> : null}
                    </div>
                    <span className={receipt.downloadedAt ? "isDone" : "isReady"}>{receipt.downloadedAt ? "Downloaded" : "Built"}</span>
                  </article>
                ))}
                {receipts.length === 0 ? <p>No export receipts yet.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
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
  return <img src={thumbnailUrl(productId, "generated", asset.output.file)} alt="" />;
}

function ScopeSummary({ products, productIds }: { products: ProductSummary[]; productIds: string[] }) {
  const selected = new Set(productIds);
  return (
    <div className="galleryScopeSummary">
      {SHAPES.map((shape) => {
        const count = products.filter((product) => selected.has(product.id) && product.shape === shape).length;
        return <span key={shape}><strong>{count}</strong>{shape}</span>;
      })}
    </div>
  );
}

function PreflightResults({ preflight }: { preflight: GalleryPreflight }) {
  return (
    <div className="galleryPreflightResults">
      <div className="galleryPreflightTotals">
        <span className="isReady"><CheckCircle2 size={14} /> {preflight.readyCount} ready</span>
        <span className={preflight.skippedCount ? "isSkipped" : ""}><XCircle size={14} /> {preflight.skippedCount} skipped</span>
      </div>
      <div className="galleryPreflightShapes">
        {preflight.shapes.map((shape) => {
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
      <div><strong>{job.status === "ready" ? "ZIP ready" : job.status === "downloaded" ? "Download complete" : job.status === "failed" ? "Export failed" : "Building export"}</strong><span>{job.progress.message}</span></div>
      {job.status === "building" || job.status === "queued" ? <><progress max={100} value={percent}>{percent}%</progress><small>{percent}% · {job.progress.completed}/{job.progress.total} files</small></> : null}
      {job.error ? <small className="isError">{job.error}</small> : null}
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
